import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { executeStep, safeName, validateConfig, evidenceType } from './validators.mjs';
import { reviewScreenshot } from './ai.mjs';
import { renderHtml } from './html.mjs';
import { assertRequestAllowed, prepareBasePolicy } from './policy.mjs';
import { axeObservations, failedStepObservation, groupObservations } from './findings.mjs';
import { comparisonKey } from './comparison.mjs';
import { validateNormalizedReport } from './report-contract.mjs';
import { screenshotWithRedaction } from './screenshot.mjs';
import { startGuardProxy } from './guard-proxy.mjs';

let runActive = false;
let activeBrowser = null;
let shutdownBound = false;

export class ConflictError extends Error {
  constructor() {
    super('Уже выполняется другая проверка. Дождитесь её завершения.');
    this.name = 'ConflictError';
  }
}

export function acquireAuditLock() {
  if (runActive) throw new ConflictError();
  runActive = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    runActive = false;
  };
}

function bindShutdown() {
  if (shutdownBound) return;
  shutdownBound = true;
  const stop = () => {
    const browser = activeBrowser;
    activeBrowser = null;
    const closing = browser ? browser.close().catch(() => {}) : Promise.resolve();
    closing.finally(() => process.exit(130));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

function maxDurationMs() {
  const requested = Number(process.env.UXPROOF_MAX_MS || 12 * 60 * 1000);
  if (!Number.isFinite(requested)) return 12 * 60 * 1000;
  return Math.min(20 * 60 * 1000, Math.max(15_000, requested));
}

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
    version: 1, runId, comparisonKey: comparisonKey(config), project: String(config.project || 'Новый проект').slice(0, 200), baseUrl: config.baseUrl,
    startedAt: new Date().toISOString(), durationMs: 0, status: 'completed',
    options: { enableAI: Boolean(config.options?.enableAI), aiProvider: config.options?.aiProvider || 'openai' },
    summary: {}, results: [], issues: [], warnings: ['На скриншотах скрыты поля ввода, редактируемые области, iframe, canvas и видео; другой видимый текст может содержать личные данные.'],
    normalizedSchemaVersion: '0.2', normalizedFindings: [], normalizedCoverage: { status: 'partial', sources: ['axe', 'playwright'], note: 'Only axe nodes with explicit selectors and failed scenario steps are included.' }
  };
  const observations = [];
  let browser;
  let proxy;
  let aiCalls = 0;
  const blockedNotes = new Set();
  const recordBlocked = message => {
    const note = String(message || '').slice(0, 160);
    if (note.startsWith('Превышен лимит сетевых')) report.status = 'incomplete';
    if (blockedNotes.size < 8 && !blockedNotes.has(note)) {
      blockedNotes.add(note);
      report.warnings.push(`Заблокирован запрос: ${note}`);
    }
  };
  bindShutdown();
  try {
    proxy = await startGuardProxy({ baseUrl: config.baseUrl, basePolicy, onBlocked: recordBlocked });
    browser = await chromium.launch({ headless: true, timeout: 45000, args: ['--disable-extensions', '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] });
    activeBrowser = browser;
    outer: for (let sIdx = 0; sIdx < config.scenarios.length; sIdx++) {
      const scenario = config.scenarios[sIdx];
      for (let vIdx = 0; vIdx < config.viewports.length; vIdx++) {
        if (Date.now() > deadline) {
          report.status = 'incomplete';
          report.warnings.push('Проверка остановлена: превышено максимальное время');
          break outer;
        }
        const vp = config.viewports[vIdx];
        const viewportLabel = vp.label || `${vp.width}×${vp.height}`;
        const result = {
          id: `${sIdx}-${vIdx}`, scenario: scenario.title, viewport: viewportLabel,
          width: vp.width, height: vp.height, status: 'passed', passedSteps: 0,
          totalSteps: scenario.steps.length, steps: [], screenshot: null, durationMs: 0
        };
        const runStart = Date.now();
        const issueStart = report.issues.length;
        const observationStart = observations.length;
        let context;
        try {
          context = await browser.newContext({
            viewport: { width: vp.width, height: vp.height },
            proxy: { server: proxy.server, username: proxy.username, password: proxy.password, bypass: '<-loopback>' },
            deviceScaleFactor: 1,
            reducedMotion: 'reduce',
            serviceWorkers: 'block'
          });
          const page = await context.newPage();
          page.setDefaultTimeout(8000);
          page.setDefaultNavigationTimeout(15000);
          const errors = [];
          let outsideOrigin = false;
          let navigationLoaded = false;
          const assertCurrentOrigin = () => {
            let currentOrigin = '';
            try { currentOrigin = new URL(page.url()).origin; } catch { /* treated as outside the project */ }
            if (currentOrigin === new URL(config.baseUrl).origin) return;
            if (!outsideOrigin) {
              outsideOrigin = true;
              result.status = 'failed';
              report.status = 'incomplete';
              report.warnings.push('Переход за пределы адреса проекта обнаружен после загрузки; дальнейшие шаги остановлены.');
              report.issues.push({ id: `NAV-${report.issues.length + 1}`, kind: 'functional', status: 'confirmed', severity: 'high',
                title: 'Переход за пределы проекта', description: 'Обнаружен переход на другой origin; шаги и сбор доказательств остановлены.',
                scenario: scenario.title, viewport: viewportLabel, screenshot: null });
            }
            throw Error('Переход за пределы адреса проекта');
          };
          page.on('pageerror', error => errors.push(String(error?.message || error).slice(0, 500)));
          await context.route('**/*', async route => {
            try {
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
              try {
                assertCurrentOrigin();
                await executeStep(page, step, config.baseUrl);
                assertCurrentOrigin();
                result.steps.push({ index: i + 1, name, type: step.type, status: 'passed', durationMs: Date.now() - stamp });
                result.passedSteps++;
              } catch (error) {
                const message = String(error?.message || error).split('\n')[0].slice(0, 450);
                if (!outsideOrigin) {
                  const observation = failedStepObservation({ pageUrl: page.url(), scenario, step, stepIndex: i, runId,
                    scenarioId: String(scenario.id || `index:${sIdx}`), viewportId: String(vp.id || `index:${vIdx}`) });
                  if (observation) observations.push(observation);
                }
                result.steps.push({ index: i + 1, name, type: step.type, status: 'failed', durationMs: Date.now() - stamp, error: message });
                result.status = 'failed';
                if (!outsideOrigin) report.issues.push({
                  id: `FUNC-${report.issues.length + 1}`, kind: 'functional', status: evidenceType('functional'), severity: 'high',
                  title: `Шаг ${i + 1}: ${name}`, description: message, scenario: scenario.title, viewport: viewportLabel,
                  reproduction: `Открыть ${config.baseUrl} → ${scenario.steps.slice(0, i + 1).map(item => item.name || item.type).join(' → ')}`,
                  step: i + 1, screenshot: null
                });
                break;
              }
            }
            if (!outsideOrigin) { try { assertCurrentOrigin(); } catch { /* incident recorded above */ } }
            if (!outsideOrigin) {
            try {
              const resultAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
              for (const violation of resultAxe.violations.slice(0, 15)) {
                observations.push(...axeObservations({ violation, pageUrl: page.url(), runId,
                  scenarioId: String(scenario.id || `index:${sIdx}`), viewportId: String(vp.id || `index:${vIdx}`) }));
                report.issues.push({
                  id: `A11Y-${report.issues.length + 1}`, kind: 'accessibility', status: evidenceType('accessibility'),
                  severity: violation.impact === 'critical' || violation.impact === 'serious' ? 'high' : 'medium',
                  title: violation.help, description: `${violation.description} · Элементы: ${violation.nodes.slice(0, 3).map(node => node.target.join(' ')).join(', ')}`,
                  scenario: scenario.title, viewport: viewportLabel, step: null, screenshot: null,
                  ruleId: violation.id, helpUrl: violation.helpUrl, affectedNodes: violation.nodes.length
                });
              }
            } catch (error) {
              report.warnings.push(`axe ${scenario.title}/${viewportLabel}: ${String(error.message || error).slice(0, 160)}`);
            }
            try {
              const overflow = await page.evaluate(() => ({ actual: document.documentElement.scrollWidth, expected: window.innerWidth }));
              if (overflow.actual > overflow.expected + 3) {
                report.issues.push({
                  id: `LAYOUT-${report.issues.length + 1}`, kind: 'overflow', status: 'confirmed', severity: 'medium',
                  title: 'Горизонтальная прокрутка страницы', description: `Контент ${overflow.actual}px шире окна ${overflow.expected}px`,
                  scenario: scenario.title, viewport: viewportLabel, screenshot: null
                });
              }
            } catch { /* страница уже закрыта */ }
            }
          } catch (error) {
            const message = String(error.message || error).split('\n')[0].slice(0, 400);
            result.status = 'failed';
            if (!outsideOrigin) report.issues.push({
              id: `NAV-${report.issues.length + 1}`, kind: 'functional', status: 'confirmed', severity: 'high',
              title: 'Не удалось открыть страницу', description: message, scenario: scenario.title, viewport: viewportLabel, screenshot: null
            });
          } finally {
            if (navigationLoaded && !outsideOrigin) { try { assertCurrentOrigin(); } catch { /* incident recorded above */ } }
            for (const message of outsideOrigin ? [] : [...new Set(errors)].slice(0, 6)) {
              report.issues.push({
                id: `JS-${report.issues.length + 1}`, kind: 'javascript', status: 'confirmed', severity: 'high',
                title: 'JavaScript exception', description: message, scenario: scenario.title, viewport: viewportLabel, screenshot: null
              });
            }
            const filename = `${sIdx + 1}-${vIdx + 1}-${safeName(scenario.id)}-${safeName(vp.id)}.png`;
            try {
              if (outsideOrigin) throw Error('Скриншот чужого origin не сохраняется');
              await screenshotWithRedaction(page, { path: path.join(screenshots, filename), fullPage: false, timeout: 8000 });
              result.screenshot = filename;
              for (let index = observationStart; index < observations.length; index++) {
                observations[index].evidence = { screenshot: filename };
              }
              for (let index = issueStart; index < report.issues.length; index++) {
                if (!report.issues[index].screenshot) report.issues[index].screenshot = filename;
              }
            } catch (error) {
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
                for (const suggestion of suggestions) {
                  report.issues.push({
                    id: `AI-${report.issues.length + 1}`, kind: 'ai-ux', status: 'recommendation',
                    severity: ['low', 'medium', 'high'].includes(suggestion.severity) ? suggestion.severity : 'low',
                    title: String(suggestion.title).slice(0, 140), description: String(suggestion.description).slice(0, 700),
                    scenario: scenario.title, viewport: viewportLabel, screenshot: filename
                  });
                }
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
          if (context) await context.close().catch(() => {});
        }
      }
    }
  } finally {
    activeBrowser = null;
    if (browser) await browser.close().catch(() => {});
    if (proxy) await proxy.close().catch(() => {});
  }
  report.durationMs = Date.now() - start;
  report.normalizedFindings = groupObservations(observations);
  validateNormalizedReport(report);
  report.summary = {
    totalRuns: report.results.length,
    passedRuns: report.results.filter(item => item.status === 'passed').length,
    failedRuns: report.results.filter(item => item.status === 'failed').length,
    confirmedIssues: report.issues.filter(item => item.status === 'confirmed').length,
    aiSuggestions: report.issues.filter(item => item.status === 'recommendation').length,
    accessibilityIssues: report.issues.filter(item => item.kind === 'accessibility').length
  };
  await fs.writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  await fs.writeFile(path.join(outputDir, 'report.html'), renderHtml(report), 'utf8');
  return report;
}

export async function runAudit(raw) {
  const release = acquireAuditLock();
  try {
    return await executeAudit(raw);
  } finally {
    release();
  }
}
