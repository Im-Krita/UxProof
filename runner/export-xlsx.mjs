import fs from 'node:fs/promises';
import path from 'node:path';
import { buildXlsx } from './xlsx.mjs';

const header = ['Проект', 'Адрес', 'Запуск', 'Сценарий', 'Экран', 'Статус', 'Шагов пройдено', 'Всего шагов', 'Длительность, с'];

const clean = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 500);

// Only the same fields as the HTML/JSON report; no page text, values or selectors.
export function reportSheets(report) {
  const summary = report?.summary || {};
  const issues = Array.isArray(report?.issues) ? report.issues : [];
  const results = Array.isArray(report?.results) ? report.results : [];
  return [
    {
      name: 'Сводка',
      rows: [
        ['UXProof · отчёт о проверке'],
        ['Проект', clean(report?.project)],
        ['Адрес', clean(report?.baseUrl)],
        ['Запуск', clean(report?.runId)],
        ['Начат', clean(report?.startedAt)],
        ['Статус', clean(report?.status)],
        ['Прогонов', Number(summary.totalRuns) || 0],
        ['Пройдено', Number(summary.passedRuns) || 0],
        ['С ошибкой', Number(summary.failedRuns) || 0],
        ['Подтверждённых проблем', Number(summary.confirmedIssues) || 0],
        ['Рекомендаций правил', Number(summary.ruleSuggestions) || 0],
        ['Подсказок ИИ', Number(summary.aiSuggestions) || 0],
        ['Доступность', Number(summary.accessibilityIssues) || 0]
      ]
    },
    {
      name: 'Проблемы',
      rows: [
        ['ID', 'Тип', 'Статус', 'Важность', 'Правило', 'Название', 'Сценарий', 'Экран', 'Шаг', 'Скриншот'],
        ...issues.slice(0, 2000).map(issue => [
          clean(issue.id), clean(issue.kind), clean(issue.status), clean(issue.severity), clean(issue.ruleId),
          clean(issue.title), clean(issue.scenario), clean(issue.viewport),
          Number.isInteger(issue.step) ? issue.step : '', clean(issue.screenshot)
        ])
      ]
    },
    {
      name: 'Прогоны',
      rows: [header, ...results.slice(0, 2000).map(result => [
        clean(report?.project), clean(report?.baseUrl), clean(report?.runId), clean(result.scenario), clean(result.viewport),
        clean(result.status), Number(result.passedSteps) || 0, Number(result.totalSteps) || 0,
        Math.round((Number(result.durationMs) || 0) / 100) / 10
      ])]
    },
    {
      name: 'Предупреждения',
      rows: [['Предупреждение'], ...(Array.isArray(report?.warnings) ? report.warnings : []).slice(0, 200).map(text => [clean(text)])]
    }
  ];
}

export async function writeXlsx(report, outputDir) {
  const data = buildXlsx(reportSheets(report));
  const target = path.join(outputDir, 'report.xlsx');
  await fs.writeFile(target, data);
  return target;
}

// On-demand export: regenerate from report.json so runs stay unchanged.
export async function exportXlsxFromRun(runDir) {
  const report = JSON.parse(await fs.readFile(path.join(runDir, 'report.json'), 'utf8'));
  return writeXlsx(report, runDir);
}
