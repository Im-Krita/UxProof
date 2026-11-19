import fs from 'node:fs/promises';
import path from 'node:path';
import { renderHtml } from './html.mjs';
import { validateNormalizedReport } from './report-contract.mjs';
import { validateScenarioEvents } from './events.mjs';
import { writeArtifactManifest } from './artifacts.mjs';
import { groupObservations } from './findings.mjs';
import { writeXlsx } from './export-xlsx.mjs';

export function maxDurationMs() {
  const requested = Number(process.env.UXPROOF_MAX_MS || 12 * 60 * 1000);
  if (!Number.isFinite(requested)) return 12 * 60 * 1000;
  return Math.min(20 * 60 * 1000, Math.max(15_000, requested));
}

export function summarize(report) {
  return {
    totalRuns: report.results.length,
    passedRuns: report.results.filter(item => item.status === 'passed').length,
    failedRuns: report.results.filter(item => item.status === 'failed').length,
    confirmedIssues: report.issues.filter(item => item.status === 'confirmed').length,
    aiSuggestions: report.issues.filter(item => item.kind === 'ai-ux' && item.status === 'recommendation').length,
    ruleSuggestions: report.issues.filter(item => item.kind !== 'ai-ux' && item.status === 'recommendation').length,
    accessibilityIssues: report.issues.filter(item => item.kind === 'accessibility').length
  };
}

// Writes report.json, report.html, report.xlsx and the artifact manifest. The
// report is made consistent first: normalization and event contracts are
// validated, and only then are summary counters and hashes computed.
export async function finalizeReport(report, observations, outputDir) {
  report.normalizedFindings = groupObservations(observations);
  validateNormalizedReport(report);
  validateScenarioEvents(report);
  report.summary = summarize(report);
  report.artifactManifest = 'artifacts.json';
  await fs.writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  await fs.writeFile(path.join(outputDir, 'report.html'), renderHtml(report), 'utf8');
  try { await writeXlsx(report, outputDir); }
  catch (error) { report.warnings.push(`Не удалось создать Excel-отчёт: ${String(error?.message || error).slice(0, 140)}`); }
  const screenshotNames = [
    ...report.results.flatMap(result => [result.screenshot, ...result.steps.map(step => step.screenshot)]),
    ...report.issues.map(issue => issue.screenshot),
    ...report.scenarioEvents.map(event => event.screenshot),
    ...report.normalizedFindings.flatMap(finding => finding.observations.map(observation => observation.evidence?.screenshot))
  ].filter(name => typeof name === 'string' && name);
  try {
    await writeArtifactManifest(outputDir, report.runId, ['report.json', 'report.html', 'report.xlsx', ...screenshotNames.map(name => `screenshots/${name}`), ...report.results.map(result => result.trace).filter(Boolean)]);
  } catch (error) {
    report.status = 'incomplete';
    delete report.artifactManifest;
    report.warnings.push(`Не удалось создать manifest артефактов: ${String(error?.message || error).slice(0, 160)}`);
    await fs.writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
    await fs.writeFile(path.join(outputDir, 'report.html'), renderHtml(report), 'utf8');
  }
  return report;
}
