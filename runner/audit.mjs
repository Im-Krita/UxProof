import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { executeStep, humanStepError, validateConfig, evidenceType } from './validators.mjs';
import { reviewScreenshot } from './ai.mjs';
import { assertRequestAllowed, prepareBasePolicy } from './policy.mjs';
import { axeObservations, countedObservation, failedStepObservation, scopeIdentifier } from './findings.mjs';
import { comparisonKey, comparisonProfileKey } from './comparison.mjs';
import { screenshotWithRedaction } from './screenshot.mjs';
import { startGuardProxy } from './guard-proxy.mjs';
import { stepEvent } from './events.mjs';
import { collectDomSummary } from './dom-summary.mjs';
import { collectElementGeometry, sameElementGeometry } from './element-geometry.mjs';
import { viewportOverflow, enabledRule } from './rules.mjs';
import { collectDuplicateHeadings } from './copy-headings.mjs';
import { runDetectors } from './detectors.mjs';
import {
  CancelledError, ConflictError, IdleError, acquireAuditLock, cancelRunningAudit,
  clearActiveBrowser, isCancelRequested, resetCancel, setActiveBrowser
} from './audit-control.mjs';
import { finalizeReport, maxDurationMs } from './audit-finalize.mjs';

export { CancelledError, ConflictError, IdleError, acquireAuditLock, cancelRunningAudit };


async function executeAudit(raw) {
  const config = validateConfig(raw);
  const basePolicy = await prepareBasePolicy(config.baseUrl);
  const outputDir = path.resolve(config.outputDir || '.uxproof-data/runs/dev');
  const screenshots = path.join(outputDir, 'screenshots');
  await fs.mkdir(screenshots, { recursive: true });
  const runId = config.runId || 'dev-run';
  const start = Date.now();
  const deadline = start + maxDurationMs();
  const report = {
    version: 1, runId, comparisonKey: comparisonKey(config), comparisonProfileKey: comparisonProfileKey(config), baseScopeId: scopeIdentifier(config.baseUrl), project: String(config.project || 'Новый проект').slice(0, 200), baseUrl: config.baseUrl,
    startedAt: new Date().toISOString(), durationMs: 0, status: 'completed',
    options: { enableAI: Boolean(config.options?.enableAI), aiProvider: config.options?.aiProvider || 'openai', ...(config.options?.disabledRules ? { disabledRules: config.options.disabledRules } : {}), ...(config.options?.trace === 'on-failure' ? { trace: 'on-failure' } : {}) },
    summary: {}, results: [], issues: [], warnings: [
      'На скриншотах скрыты поля ввода, редактируемые области, iframe, canvas, видео и совпадения значений fill/expectValue в тексте. Видимый текст страницы может остаться на PNG.',
      'Лимит 10 000 относится к рукопожатиям прокси (HTTP-запросы и CONNECT), а не к запросам внутри HTTPS.'
    ],
    normalizedSchemaVersion: '0.3', normalizedFindings: [], normalizedCoverage: { status: 'partial', sources: ['axe', 'playwright', 'runtime', 'layout', 'copy', 'ai'], note: 'Axe nodes, failed steps, JS exceptions, overflow, duplicate headings and AI suggestions are included; coverage stays partial.' },
    scenarioEventsVersion: '0.1', scenarioEvents: []
  };
  const observations = [];
  let browser;
  let proxy;
  let aiCalls = 0;
  let traceBytes = 0;
  if (config.options?.trace === 'on-failure') report.warnings.push('Trace включён: ZIP-файлы могут содержать данные страницы, значения полей и сетевые сведения; храните и передавайте их осторожно.');
  const blockedNotes = new Set();
  const recordBlocked = message => {
    const note = String(message || '').slice(0, 160);
    if (note.startsWith('Превышен лимит сетевых')) report.status = 'incomplete';
    if (blockedNotes.size < 8 && !blockedNotes.has(note)) {
      blockedNotes.add(note);
      report.warnings.push(`Заблокирован запрос: ${note}`);
    }
  };
  try {
    proxy = await startGuardProxy({ baseUrl: config.baseUrl, basePolicy, onBlocked: recordBlocked });
    browser = await chromium.launch({ headless: true, timeout: 45000, args: ['--disable-extensions', '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] });
    setActiveBrowser(browser);
    outer: for (let sIdx = 0; sIdx < config.scenarios.length; sIdx++) {
      const scenario = config.scenarios[sIdx];
      const maskTextValues = scenario.steps.filter(step => ['fill', 'expectValue'].includes(step.type) && typeof step.value === 'string').map(step => step.value);
      for (let vIdx = 0; vIdx < config.viewports.length; vIdx++) {
        if (isCancelRequested()) break outer;
        if (Date.now() > deadline) {
          report.status = 'incomplete';
          report.warnings.push('Проверка остановлена: превышено максимальное время');
          break outer;
        }
        const vp = config.viewports[vIdx];
        const viewportLabel = vp.label || `${vp.width}×${vp.height}`;
        const scopeIds = { scenarioId: String(scenario.id || `index:${sIdx}`), viewportId: String(vp.id || `index:${vIdx}`) };
        const result = {
          id: `${sIdx}-${vIdx}`, scenario: scenario.title, viewport: viewportLabel,
          width: vp.width, height: vp.height, status: 'passed', passedSteps: 0,
          totalSteps: scenario.steps.length, steps: [], screenshot: null, durationMs: 0
        };
        const runStart = Date.now();
        const issueStart = report.issues.length;
        const observationStart = observations.length;
        let context, tracingStarted = false, outsideOrigin = false;
        try {
          context = await browser.newContext({
            viewport: { width: vp.width, height: vp.height },
            proxy: { server: proxy.server, username: proxy.username, password: proxy.password, bypass: '<-loopback>' },
            deviceScaleFactor: 1,
            reducedMotion: 'reduce',
            serviceWorkers: 'block'
          });
          if (config.options?.trace === 'on-failure') {
            try { await context.tracing.start({ screenshots: true, snapshots: true, sources: false }); tracingStarted = true; }
            catch { report.warnings.push(`Не удалось начать trace: ${scenario.title}/${viewportLabel}`); }
          }
          const projectOrigin = new URL(config.baseUrl).origin;
          let pageErrorCount = 0;
          let mainPage;
          let axeRunning = false;
          const extraPages = new Set();
          // axe-core/playwright injects its source through a helper about:blank
          // page. Closing every extra page kills that helper mid-analysis, so a
          // blank helper is kept (with all requests aborted) until axe finishes.
          const closeExtraPages = () => {
            for (const extra of extraPages) extra.close().catch(() => {});
            extraPages.clear();
          };
          context.on('page', nextPage => {
            nextPage.on('pageerror', () => { pageErrorCount = Math.min(pageErrorCount + 1, 1000); });
            if (!mainPage || nextPage === mainPage) return;
            nextPage.route('**/*', route => route.abort('blockedbyclient')).catch(() => {});
            if (axeRunning && nextPage.url() === 'about:blank') { extraPages.add(nextPage); return; }
            nextPage.close().catch(() => {});
          });
          const page = await context.newPage();
          mainPage = page;
          page.setDefaultTimeout(8000);
          page.setDefaultNavigationTimeout(15000);
          let navigationLoaded = false;
          const recordOutsideOrigin = message => {
            if (outsideOrigin) return;
            outsideOrigin = true;
            result.status = 'failed';
            report.status = 'incomplete';
            report.warnings.push(message);
            report.issues.push({ id: `NAV-${report.issues.length + 1}`, kind: 'functional', status: 'confirmed', severity: 'high',
              title: 'Переход за пределы проекта', description: 'Обнаружен переход на другой origin; шаги и сбор доказательств остановлены.',
              scenario: scenario.title, viewport: viewportLabel, screenshot: null, ruleId: 'navigate:outside', ...scopeIds });
          };
          const assertCurrentOrigin = () => {
            if (outsideOrigin) throw Error('Переход за пределы адреса проекта');
            for (const current of context.pages()) {
              const currentUrl = current.url();
              if (!currentUrl || currentUrl === 'about:blank') continue;
              let currentOrigin = '';
              try { currentOrigin = new URL(currentUrl).origin; } catch { /* treated as outside the project */ }
              if (currentOrigin === projectOrigin) continue;
              recordOutsideOrigin('Переход за пределы адреса проекта обнаружен после загрузки; дальнейшие шаги остановлены.');
              throw Error('Переход за пределы адреса проекта');
            }
          };
          const stopForeignNavigation = async route => {
            recordOutsideOrigin('Переход за пределы адреса проекта заблокирован до загрузки; дальнейшие шаги остановлены.');
            await route.abort('blockedbyclient').catch(() => {});
          };
          await context.route('**/*', async route => {
            try {
              const request = route.request();
              if (request.isNavigationRequest()) {
                let requestUrl;
                try { requestUrl = new URL(request.url()); }
                catch { await stopForeignNavigation(route); return; }
                if (requestUrl.protocol !== 'about:' && requestUrl.origin !== projectOrigin) {
                  await stopForeignNavigation(route);
                  return;
                }
                if (requestUrl.protocol !== 'about:') {
                  const response = await route.fetch({ maxRedirects: 0 });
                  const status = response.status();
                  if (status >= 300 && status < 400) {
                    const location = response.headers()['location'];
                    if (location) {
                      let next;
                      try { next = new URL(location, request.url()); } catch { next = null; }
                      if (!next || next.origin !== projectOrigin) {
                        await stopForeignNavigation(route);
                        return;
                      }
                    }
                  }
                  await route.fulfill({ response });
                  return;
                }
              }
              await assertRequestAllowed(route.request().url(), config.baseUrl, basePolicy.baseLoopback, undefined, basePolicy.addresses);
              await route.continue();
            } catch (error) {
              recordBlocked(error?.message || error);
              await route.abort('blockedbyclient').catch(() => {});
            }
          });
          try {
            await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            navigationLoaded = true;
            assertCurrentOrigin();
            for (let i = 0; i < scenario.steps.length; i++) {
              const step = scenario.steps[i];
              const stamp = Date.now();
              const name = step.name || `${step.type}${step.target ? `: ${step.target}` : ''}`;
              const eventBase = { runId, combinationId: result.id, scenarioId: String(scenario.id || `index:${sIdx}`),
                viewportId: String(vp.id || `index:${vIdx}`), stepId: String(i + 1), stepType: step.type };
              report.scenarioEvents.push(stepEvent(eventBase, 'before'));
              try {
                assertCurrentOrigin();
                report.scenarioEvents.push(stepEvent(eventBase, 'action'));
                await executeStep(page, step, config.baseUrl);
                assertCurrentOrigin();
                const scope = scopeIdentifier(page.url());
                report.scenarioEvents.push(stepEvent(eventBase, 'after', scope ? { pageScopeId: scope } : {}));
                result.steps.push({ index: i + 1, name, type: step.type, status: 'passed', durationMs: Date.now() - stamp });
                result.passedSteps++;
              } catch (error) {
                const durationMs = Date.now() - stamp;
                const failedAt = new Date().toISOString();
                const message = String(error?.message || error).split('\n')[0].slice(0, 450);
                let errorScreenshot = null;
                let wroteErrorScreenshot = false;
                let geometryBefore = null;
                const errorFilename = `error-${sIdx + 1}-${vIdx + 1}-${i + 1}.png`;
                if (!outsideOrigin) {
                  try {
                    assertCurrentOrigin();
                    if (step.target) geometryBefore = await collectElementGeometry(page, step.target);
                    assertCurrentOrigin();
                    await screenshotWithRedaction(page, { path: path.join(screenshots, errorFilename), fullPage: false, timeout: 8000 }, { maskTextValues });
                    wroteErrorScreenshot = true;
                    assertCurrentOrigin();
                    errorScreenshot = errorFilename;
                  } catch (captureError) {
                    if (wroteErrorScreenshot && outsideOrigin) await fs.unlink(path.join(screenshots, errorFilename)).catch(() => {});
                    if (!outsideOrigin) report.warnings.push(`Скриншот ошибки ${scenario.title}/${viewportLabel}: ${String(captureError.message || captureError).slice(0, 140)}`);
                  }
                }
                let domSummary = null;
                let elementGeometry = null;
                if (!outsideOrigin && errorScreenshot && geometryBefore && step.target) {
                  const geometryAfter = await collectElementGeometry(page, step.target);
                  if (sameElementGeometry(geometryBefore, geometryAfter)) elementGeometry = geometryAfter;
                  try { assertCurrentOrigin(); } catch { elementGeometry = null; }
                }
                if (!outsideOrigin) {
                  try {
                    assertCurrentOrigin();
                    const summary = await collectDomSummary(page);
                    assertCurrentOrigin();
                    domSummary = summary;
                  } catch {
                    if (!outsideOrigin) report.warnings.push(`Не удалось получить структурную сводку DOM: ${scenario.title}/${viewportLabel}`);
                  }
                }
                if (!outsideOrigin) { try { assertCurrentOrigin(); } catch { /* incident recorded above */ } }
                if (outsideOrigin && errorScreenshot) {
                  await fs.unlink(path.join(screenshots, errorScreenshot)).catch(() => {});
                  errorScreenshot = null;
                  domSummary = null;
                  elementGeometry = null;
                }
                if (!outsideOrigin) {
                  const observation = failedStepObservation({ pageUrl: page.url(), scenario, step, stepIndex: i, runId,
                    scenarioId: String(scenario.id || `index:${sIdx}`), viewportId: String(vp.id || `index:${vIdx}`) });
                  if (observation) {
                    if (errorScreenshot) observation.evidence = { screenshot: errorScreenshot };
                    observations.push(observation);
                  }
                }
                result.steps.push({ index: i + 1, name, type: step.type, status: 'failed', durationMs, error: message, screenshot: errorScreenshot });
                const scope = outsideOrigin ? null : scopeIdentifier(page.url());
                report.scenarioEvents.push(stepEvent(eventBase, 'error', { at: failedAt, screenshot: errorScreenshot, domSummary, elementGeometry, ...(scope ? { pageScopeId: scope } : {}) }));
                result.status = 'failed';
                if (!outsideOrigin) report.issues.push({
                  id: `FUNC-${report.issues.length + 1}`, kind: 'functional', status: evidenceType('functional'), severity: 'high',
                  title: `Шаг ${i + 1}: ${name}`, description: humanStepError(step, message), scenario: scenario.title, viewport: viewportLabel,
                  reproduction: `Открыть ${config.baseUrl} → ${scenario.steps.slice(0, i + 1).map(item => item.name || item.type).join(' → ')}`,
                  step: i + 1, screenshot: errorScreenshot, ...scopeIds
                });
                break;
              }
            }
            if (!outsideOrigin) { try { assertCurrentOrigin(); } catch { /* incident recorded above */ } }
            if (!outsideOrigin) {
            try {
              axeRunning = true;
              const resultAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
              for (const violation of resultAxe.violations.slice(0, 15)) {
                observations.push(...axeObservations({ violation, pageUrl: page.url(), runId,
                  scenarioId: String(scenario.id || `index:${sIdx}`), viewportId: String(vp.id || `index:${vIdx}`) }));
                report.issues.push({
                  id: `A11Y-${report.issues.length + 1}`, kind: 'accessibility', status: evidenceType('accessibility'),
                  severity: violation.impact === 'critical' || violation.impact === 'serious' ? 'high' : 'medium',
                  title: violation.help, description: `${violation.description} · Элементы: ${violation.nodes.slice(0, 3).map(node => node.target.join(' ')).join(', ')}`,
                  scenario: scenario.title, viewport: viewportLabel, step: null, screenshot: null,
                  ruleId: violation.id, helpUrl: violation.helpUrl, affectedNodes: violation.nodes.length, ...scopeIds
                });
              }
            } catch (error) {
              report.warnings.push(`axe ${scenario.title}/${viewportLabel}: ${String(error.message || error).slice(0, 160)}`);
            } finally {
              axeRunning = false;
              closeExtraPages();
            }
            try {
              const overflow = viewportOverflow(await page.evaluate(() => ({ actual: document.documentElement.scrollWidth, expected: window.innerWidth })), config.options?.disabledRules);
              if (overflow) {
                const observation = countedObservation({
                  pageUrl: page.url(), runId, scenarioId: String(scenario.id || `index:${sIdx}`), viewportId: String(vp.id || `index:${vIdx}`),
                  ruleId: overflow.ruleId, source: 'layout', classification: 'rule-violation', status: 'confirmed', token: `overflow:${overflow.actual}x${overflow.expected}`
                });
                if (observation) observations.push(observation);
                report.issues.push({
                  id: `LAYOUT-${report.issues.length + 1}`, kind: 'overflow', status: 'confirmed', severity: 'medium',
                  ruleId: overflow.ruleId, title: overflow.title, description: overflow.description,
                  scenario: scenario.title, viewport: viewportLabel, screenshot: null, ...scopeIds
                });
              }
            } catch { /* страница уже закрыта */ }
            if (navigationLoaded && !outsideOrigin) {
              try {
                const detected = await runDetectors({
                  page,
                  isEnabled: ruleId => enabledRule(ruleId, config.options?.disabledRules),
                  makeObservation: ({ ruleId, source, classification, status, token }) => countedObservation({
                    pageUrl: page.url(), runId, scenarioId: String(scenario.id || `index:${sIdx}`), viewportId: String(vp.id || `index:${vIdx}`),
                    ruleId, source, classification, status, token
                  }),
                  makeIssue: issue => ({ id: `${issue.kind === 'copy' ? 'COPY' : 'LAYOUT'}-${report.issues.length + 1}`, ...issue }),
                  title: scenario.title, viewport: viewportLabel, scopeIds
                });
                observations.push(...detected.observations);
                report.issues.push(...detected.issues);
                assertCurrentOrigin();
              } catch (error) {
                if (outsideOrigin) throw Error('Переход за пределы адреса проекта');
                report.warnings.push(`Дополнительные правила ${scenario.title}/${viewportLabel}: ${String(error?.message || error).slice(0, 140)}`);
              }
            }
            }
          } catch (error) {
            const message = String(error.message || error).split('\n')[0].slice(0, 400);
            result.status = 'failed';
            if (!outsideOrigin) report.issues.push({
              id: `NAV-${report.issues.length + 1}`, kind: 'functional', status: 'confirmed', severity: 'high',
              title: 'Не удалось открыть страницу', description: message, scenario: scenario.title, viewport: viewportLabel, screenshot: null,
              ruleId: 'navigate:open-failed', ...scopeIds
            });
          } finally {
            if (navigationLoaded && !outsideOrigin) { try { assertCurrentOrigin(); } catch { /* incident recorded above */ } }
            if (!outsideOrigin && pageErrorCount) {
              const observation = countedObservation({
                pageUrl: page.url(), runId, scenarioId: String(scenario.id || `index:${sIdx}`), viewportId: String(vp.id || `index:${vIdx}`),
                ruleId: 'javascript:pageerror', source: 'runtime', classification: 'technical-fact', status: 'confirmed', token: `count:${pageErrorCount}`
              });
              if (observation) observations.push(observation);
              report.issues.push({
                id: `JS-${report.issues.length + 1}`, kind: 'javascript', status: 'confirmed', severity: 'high',
                title: 'JavaScript exception', description: `На странице возникло исключений: ${pageErrorCount}${pageErrorCount === 1000 ? '+' : ''}. Сообщения исключений не сохраняются.`, scenario: scenario.title, viewport: viewportLabel, screenshot: null,
                ruleId: 'javascript:pageerror', ...scopeIds
              });
            }
            const filename = `run-${sIdx + 1}-${vIdx + 1}.png`;
            let wroteFinalScreenshot = false;
            try {
              if (outsideOrigin) throw Error('Скриншот чужого origin не сохраняется');
              await screenshotWithRedaction(page, { path: path.join(screenshots, filename), fullPage: false, timeout: 8000 }, { maskTextValues });
              wroteFinalScreenshot = true;
              if (navigationLoaded) assertCurrentOrigin();
              result.screenshot = filename;
              for (let index = observationStart; index < observations.length; index++) {
                if (observations[index].source !== 'playwright' && !observations[index].evidence) observations[index].evidence = { screenshot: filename };
              }
              for (let index = issueStart; index < report.issues.length; index++) {
                if (!report.issues[index].screenshot && !Number.isInteger(report.issues[index].step)) report.issues[index].screenshot = filename;
              }
              if (navigationLoaded && enabledRule('copy:duplicate-heading', config.options?.disabledRules)) {
                try {
                  const copy = await collectDuplicateHeadings(page);
                  assertCurrentOrigin();
                  if (copy.truncated) report.warnings.push(`Проверка повторов ограничена 5000 элементами: ${scenario.title}/${viewportLabel}`);
                  if (copy.duplicateGroups) {
                    const observation = countedObservation({
                      pageUrl: page.url(), runId, scenarioId: String(scenario.id || `index:${sIdx}`), viewportId: String(vp.id || `index:${vIdx}`),
                      ruleId: 'copy:duplicate-heading', source: 'copy', classification: 'hypothesis', status: 'recommendation', token: `groups:${copy.duplicateGroups}`
                    });
                    if (observation) {
                      observation.evidence = { screenshot: filename };
                      observations.push(observation);
                    }
                    report.issues.push({
                    id: `COPY-${report.issues.length + 1}`, kind: 'copy', status: 'recommendation', severity: 'low',
                    ruleId: 'copy:duplicate-heading', title: 'Возможно, повторяются заголовки',
                    description: `В видимой области найдено повторяющихся групп: ${copy.duplicateGroups} (заголовков: ${copy.duplicateHeadings}). Проверьте контекст: повторение может быть необходимым.`,
                    scenario: scenario.title, viewport: viewportLabel, screenshot: filename, ...scopeIds
                  });
                  }
                } catch {
                  if (outsideOrigin) throw Error('Переход за пределы адреса проекта');
                  report.warnings.push(`Не удалось проверить повторение заголовков: ${scenario.title}/${viewportLabel}`);
                }
              }
            } catch (error) {
              if (wroteFinalScreenshot && outsideOrigin) {
                await fs.unlink(path.join(screenshots, filename)).catch(() => {});
                result.screenshot = null;
                for (let index = observationStart; index < observations.length; index++) if (observations[index].evidence?.screenshot === filename) delete observations[index].evidence;
                for (let index = issueStart; index < report.issues.length; index++) if (report.issues[index].screenshot === filename) report.issues[index].screenshot = null;
              }
              report.warnings.push(`Скриншот ${scenario.title}/${viewportLabel}: ${String(error.message || error).slice(0, 140)}`);
            }
            result.durationMs = Date.now() - runStart;
            report.results.push(result);
            if (config.options?.enableAI && result.screenshot && aiCalls < 3 && vIdx === config.viewports.length - 1) {
              aiCalls++;
              try {
                const suggestions = await reviewScreenshot({
                  file: path.join(screenshots, filename), scenario: scenario.title, viewport: viewportLabel,
                  provider: config.options?.aiProvider || 'openai',
                  findings: report.issues.filter(issue => issue.scenario === scenario.title && issue.viewport === viewportLabel).map(issue => issue.title)
                });
                suggestions.forEach((suggestion, index) => {
                  const observation = countedObservation({
                    pageUrl: config.baseUrl, runId, scenarioId: String(scenario.id || `index:${sIdx}`), viewportId: String(vp.id || `index:${vIdx}`),
                    ruleId: `ai-ux:slot-${index + 1}`, source: 'ai', classification: 'hypothesis', status: 'recommendation', token: `slot:${index + 1}`
                  });
                  if (observation) {
                    observation.evidence = { screenshot: filename };
                    observations.push(observation);
                  }
                  report.issues.push({
                    id: `AI-${report.issues.length + 1}`, kind: 'ai-ux', status: 'recommendation',
                    severity: ['low', 'medium', 'high'].includes(suggestion.severity) ? suggestion.severity : 'low',
                    title: String(suggestion.title).slice(0, 140), description: String(suggestion.description).slice(0, 700),
                    scenario: scenario.title, viewport: viewportLabel, screenshot: filename,
                    ruleId: `ai-ux:slot-${index + 1}`, ...scopeIds
                  });
                });
              } catch (error) {
                report.warnings.push(`ИИ ${scenario.title}: ${String(error.message || error).slice(0, 260)}`);
              }
            }
          }
        } catch (error) {
          result.status = 'failed';
          result.durationMs = Date.now() - runStart;
          report.results.push(result);
          report.warnings.push(`Сбой браузера ${scenario.title}/${viewportLabel}: ${String(error.message || error).slice(0, 180)}`);
        } finally {
          if (context && tracingStarted) {
            const relative = `traces/trace-${sIdx + 1}-${vIdx + 1}.zip`;
            const tracePath = path.join(outputDir, ...relative.split('/'));
            try {
              if (result.status === 'failed' && !outsideOrigin && traceBytes < 100 * 1024 * 1024) {
                await fs.mkdir(path.dirname(tracePath), { recursive: true });
                await context.tracing.stop({ path: tracePath });
                const { size } = await fs.stat(tracePath);
                if (size > 20 * 1024 * 1024 || traceBytes + size > 100 * 1024 * 1024) {
                  await fs.unlink(tracePath);
                  report.warnings.push(`Trace превышает лимит размера: ${scenario.title}/${viewportLabel}`);
                } else { traceBytes += size; result.trace = relative; }
              } else {
                await context.tracing.stop();
                if (result.status === 'failed' && !outsideOrigin) report.warnings.push(`Trace пропущен: достигнут общий лимит размера`);
              }
            } catch {
              await fs.unlink(tracePath).catch(() => {});
              report.warnings.push(`Не удалось сохранить trace: ${scenario.title}/${viewportLabel}`);
            }
          }
          if (context) await context.close().catch(() => {});
        }
      }
    }
  } finally {
    clearActiveBrowser();
    if (browser) await browser.close().catch(() => {});
    if (proxy) await proxy.close().catch(() => {});
  }
  if (isCancelRequested()) throw new CancelledError();
  report.durationMs = Date.now() - start;
  return finalizeReport(report, observations, outputDir);
}

export async function runAudit(raw) {
  const release = acquireAuditLock();
  resetCancel();
  try {
    return await executeAudit(raw);
  } finally {
    resetCancel();
    release();
  }
}
