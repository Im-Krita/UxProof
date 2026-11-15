import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { runAudit } from '../runner/audit.mjs';

const ping = await fetch('http://127.0.0.1:4180/').catch(() => null);
if (!ping?.ok) {
  console.error('Relay не запущен на http://127.0.0.1:4180. Сначала выполните npm run demo.');
  process.exit(1);
}

const config = JSON.parse(await fs.readFile(new URL('../samples/demo.audit.json', import.meta.url), 'utf8'));
const runId = crypto.randomUUID();
const outputDir = path.resolve('.uxproof-data/runs', runId);
const report = await runAudit({ ...config, runId, outputDir });
const summaryPath = path.resolve('.uxproof-data/acceptance-buggy.json');
const brief = {
  runId,
  outputDir,
  summary: report.summary,
  results: report.results.map(item => ({ scenario: item.scenario, viewport: item.viewport, status: item.status, passedSteps: item.passedSteps, totalSteps: item.totalSteps, failedStep: item.steps.find(step => step.status === 'failed')?.name || null })),
  issueKinds: [...new Set(report.issues.map(item => `${item.scenario}|${item.viewport}|${item.kind}|${item.ruleId || ''}`))]
};
await fs.writeFile(summaryPath, JSON.stringify(brief, null, 2));
console.log(JSON.stringify(brief, null, 2));

const row = (scenario, viewport) => {
  const found = report.results.find(item => item.scenario === scenario && item.viewport === viewport);
  if (!found) throw new Error(`Нет прогона: ${scenario} / ${viewport}`);
  return found;
};
const failedStep = item => item.steps.find(step => step.status === 'failed');
const has = (scenario, viewport, kind, ruleId) => report.issues.some(item => item.scenario === scenario && (!viewport || item.viewport === viewport) && item.kind === kind && (!ruleId || item.ruleId === ruleId));

let failed = false;
const expect = (condition, message) => { if (!condition) { console.error(message); failed = true; } };
for (const viewport of ['Desktop', 'Tablet', 'Mobile']) {
  const server = row('Выбор и подключение сервера', viewport);
  expect(server.status === 'passed' && server.passedSteps === 4, `Сервер ${viewport} должен пройти 4/4`);
  const settings = row('Сохранение настроек', viewport);
  expect(settings.status === 'failed' && failedStep(settings)?.name === 'Увидеть подтверждение сохранения', `Настройки ${viewport} должны упасть на подтверждении`);
  expect(has('Сохранение настроек', viewport, 'javascript'), `Настройки ${viewport}: нет JavaScript exception`);
  expect(has('Сохранение настроек', viewport, 'overflow'), `Настройки ${viewport}: нет overflow`);
  expect(has('Сохранение настроек', viewport, 'accessibility', 'color-contrast'), `Настройки ${viewport}: нет color-contrast`);
  expect(has('Возврат на главную', viewport, 'javascript'), `Навигация ${viewport}: нет JavaScript exception`);
}
expect(row('Возврат на главную', 'Desktop').status === 'passed', 'Навигация Desktop должна пройти');
expect(row('Возврат на главную', 'Tablet').status === 'passed', 'Навигация Tablet должна пройти');
const mobileNav = row('Возврат на главную', 'Mobile');
expect(mobileNav.status === 'failed' && failedStep(mobileNav)?.name === 'Вернуться на главную', 'Навигация Mobile должна упасть на скрытой кнопке');
expect(report.summary.totalRuns === 9 && report.summary.passedRuns === 5 && report.summary.failedRuns === 4, `Ожидали 5/9, получили ${report.summary.passedRuns}/${report.summary.totalRuns}`);
expect(report.issues.every(item => item.status !== 'recommendation'), 'Рекомендации ИИ появились без запроса');
expect(report.issues.filter(item => item.kind === 'functional').every(item => item.status === 'confirmed' && item.screenshot), 'Функциональный дефект без подтверждения или скриншота');
for (const item of report.results) {
  expect(item.screenshot && await fs.stat(path.join(outputDir, 'screenshots', item.screenshot)).then(stat => stat.size > 1000).catch(() => false), `Нет скриншота ${item.scenario}/${item.viewport}`);
}
expect(await fs.stat(path.join(outputDir, 'report.html')).then(stat => stat.size > 200).catch(() => false), 'Нет HTML-отчёта');
if (failed) process.exitCode = 1;
else console.log(`Buggy Relay подтверждён: ${summaryPath}`);
