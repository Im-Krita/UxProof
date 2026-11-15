import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { runAudit } from '../runner/audit.mjs';

const ping = await fetch('http://127.0.0.1:4180/fixed').catch(() => null);
if (!ping?.ok) {
  console.error('Relay не запущен. Сначала выполните npm run demo.');
  process.exit(1);
}

const config = JSON.parse(await fs.readFile(new URL('../samples/demo.audit.json', import.meta.url), 'utf8'));
config.baseUrl = 'http://127.0.0.1:4180/fixed';
config.project = 'Relay — исправленный вариант';
const runId = crypto.randomUUID();
const outputDir = path.resolve('.uxproof-data/runs', runId);
const report = await runAudit({ ...config, runId, outputDir });
const summaryPath = path.resolve('.uxproof-data/acceptance-fixed.json');
const brief = {
  runId,
  outputDir,
  summary: report.summary,
  results: report.results.map(item => ({ scenario: item.scenario, viewport: item.viewport, status: item.status, passedSteps: item.passedSteps, totalSteps: item.totalSteps })),
  remaining: report.issues.map(item => ({ scenario: item.scenario, viewport: item.viewport, kind: item.kind, ruleId: item.ruleId || '', title: item.title }))
};
await fs.writeFile(summaryPath, JSON.stringify(brief, null, 2));
console.log(JSON.stringify(brief, null, 2));

let failed = false;
const expect = (condition, message) => { if (!condition) { console.error(message); failed = true; } };
expect(report.summary.totalRuns === 9 && report.summary.passedRuns === 9 && report.summary.failedRuns === 0, `Исправленный вариант: ${report.summary.passedRuns}/9 вместо 9/9`);
expect(!report.issues.some(item => item.kind === 'functional'), 'Функциональные дефекты не исчезли');
expect(!report.issues.some(item => item.kind === 'javascript'), 'JavaScript exception не исчез');
expect(!report.issues.some(item => item.kind === 'overflow'), 'Горизонтальный вылет не исчез');
expect(!report.issues.some(item => item.ruleId === 'color-contrast'), 'Слабый контраст не исчез');
expect(!report.issues.some(item => item.status === 'recommendation'), 'Появилась рекомендация ИИ');
if (failed) process.exitCode = 1;
else console.log(`Исправленный Relay подтверждён: ${summaryPath}`);
