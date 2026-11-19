// QA-20 / FR-014 / FR-021 live check against a local Ollama instance.
// Opt-in: `ollama pull qwen2.5vl:3b` (vision) and `ollama pull qwen2.5:3b` (planner),
// then `npm run demo` in another shell and `node scripts/qa-ollama.mjs`.
// Nothing here talks to a paid cloud model.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runAudit } from '../runner/audit.mjs';
import { planScenario } from '../runner/planner.mjs';

const OLLAMA = process.env.UXPROOF_OLLAMA_URL || 'http://127.0.0.1:11434';
const VISION_MODEL = process.env.UXPROOF_VISION_MODEL || 'qwen2.5vl:3b';
const PLANNER_MODEL = process.env.UXPROOF_PLANNER_MODEL || 'qwen2.5:3b';
const BASE = 'http://127.0.0.1:4180';

let failed = false;
const fail = message => { failed = true; console.error(`FAIL ${message}`); };
const ok = message => console.log(`OK   ${message}`);

const tags = await fetch(`${OLLAMA}/api/tags`).then(response => response.json()).catch(() => null);
if (!tags) {
  console.error(`Ollama недоступен на ${OLLAMA}. Запустите "ollama serve" и повторите.`);
  process.exit(1);
}
const installed = new Set((tags.models || []).map(model => model.name));
const has = name => installed.has(name) || installed.has(`${name}:latest`);
if (!has(VISION_MODEL) || !has(PLANNER_MODEL)) {
  console.error(`Нужны модели: ${VISION_MODEL}, ${PLANNER_MODEL}. Установлено: ${[...installed].join(', ') || 'ничего'}`);
  process.exit(1);
}

const relay = await fetch(BASE).catch(() => null);
if (!relay?.ok) {
  console.error(`Relay не запущен на ${BASE}. Сначала выполните npm run demo.`);
  process.exit(1);
}

// FR-021: planner output must pass the same validator as a real run.
process.env.UXPROOF_OLLAMA_MODEL = PLANNER_MODEL;
const plannedAt = Date.now();
try {
  const steps = await planScenario({
    goal: 'Открыть экран настроек и убедиться, что видна кнопка сохранения',
    baseUrl: BASE,
    provider: 'ollama',
    timeoutMs: 90000
  });
  if (!steps.length) fail('FR-021 планировщик вернул пустой список шагов');
  else {
    ok(`FR-021 planner (${PLANNER_MODEL}): ${steps.length} шаг(ов) за ${Date.now() - plannedAt} мс`);
    for (const step of steps) console.log(`     · ${step.type}${step.target ? ` ${step.target}` : ''}${step.value ? ` = ${step.value}` : ''}`);
  }
} catch (error) {
  fail(`FR-021 планировщик: ${error.message}`);
}

// FR-014: live vision review of a real screenshot from a real run.
process.env.UXPROOF_OLLAMA_MODEL = VISION_MODEL;
process.env.UXPROOF_AI_TIMEOUT_MS = '180000';
const config = JSON.parse(await fs.readFile(new URL('../samples/demo.audit.json', import.meta.url), 'utf8'));
const runId = crypto.randomUUID();
const outputDir = path.resolve('.uxproof-data/runs', runId);
const report = await runAudit({
  ...config,
  runId,
  outputDir,
  scenarios: config.scenarios.slice(0, 1),
  viewports: config.viewports.slice(0, 1),
  options: { ...config.options, enableAI: true, aiProvider: 'ollama' }
});

const aiIssues = report.issues.filter(issue => issue.kind === 'ai-ux');
const aiWarnings = report.warnings.filter(warning => warning.startsWith('ИИ '));
if (aiWarnings.length) fail(`FR-014 предупреждения ИИ: ${aiWarnings.join(' | ')}`);
if (!aiIssues.length) fail('FR-014 модель не вернула ни одной рекомендации');
else ok(`FR-014 vision (${VISION_MODEL}): ${aiIssues.length} рекомендаци(и)`);
for (const issue of aiIssues) {
  if (issue.status !== 'recommendation') fail(`FR-014 рекомендация ${issue.id} имеет статус ${issue.status}`);
  if (!issue.screenshot) fail(`FR-014 рекомендация ${issue.id} без скриншота`);
  console.log(`     · [${issue.severity}] ${issue.title}`);
  console.log(`       ${issue.description.slice(0, 200)}`);
}
if (report.summary.aiSuggestions !== aiIssues.length) fail('FR-014 счётчик aiSuggestions не совпадает со списком');
if (report.issues.some(issue => issue.kind === 'ai-ux' && issue.status === 'confirmed')) fail('FR-014 ИИ-находка помечена как подтверждённый дефект');
ok(`FR-014 отчёт: ${path.join(outputDir, 'report.json')}`);

process.exitCode = failed ? 1 : 0;
if (!failed) console.log('QA-20: живая локальная модель подтверждена (vision + planner)');
