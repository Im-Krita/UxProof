import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateNormalizedReport } from '../report-contract.mjs';
import { axeObservations, groupObservations, failedStepObservation } from '../findings.mjs';

function report() {
  const observations = axeObservations({ violation: { id: 'contrast', nodes: [{ target: ['#label'] }] }, pageUrl: 'https://example.test/', scenarioId: 's', viewportId: 'v', runId: 'r' });
  observations[0].evidence = { screenshot: '1-s.png' };
  return { runId: 'r', normalizedSchemaVersion: '0.1', normalizedCoverage: { status: 'partial', sources: ['axe'] }, normalizedFindings: groupObservations(observations) };
}

test('validates normalized observations and accepts legacy reports without modification', () => {
  assert.equal(validateNormalizedReport(report()), true);
  assert.equal(validateNormalizedReport({ version: 1, runId: 'old' }), true);
});

test('v0.2 accepts Playwright failed-step evidence while v0.1 remains axe-only', () => {
  const value = report();
  const step = { type: 'click', target: 'css:#save' };
  const observation = failedStepObservation({ pageUrl: 'https://example.test/', scenario: { steps: [step] }, step, stepIndex: 0, scenarioId: 's', viewportId: 'v', runId: 'r' });
  value.normalizedFindings.push(...groupObservations([observation]));
  assert.throws(() => validateNormalizedReport(value));
  value.normalizedSchemaVersion = '0.2';
  value.normalizedCoverage.sources.push('playwright');
  assert.equal(validateNormalizedReport(value), true);
  delete value.normalizedFindings[1].observations[0].stepId;
  assert.throws(() => validateNormalizedReport(value));
});

test('rejects mismatched IDs, missing fields, duplicate observations and unsafe evidence', () => {
  for (const mutate of [
    r => { r.normalizedFindings[0].findingId = 'wrong'; },
    r => { r.normalizedFindings[0].observations[0].runId = 'other'; },
    r => { r.normalizedFindings[0].observations[0].evidence.screenshot = '../secret.png'; },
    r => { r.normalizedFindings[0].observations.push(r.normalizedFindings[0].observations[0]); },
    r => { delete r.normalizedFindings[0].observations[0].scenarioId; },
    r => { r.normalizedSchemaVersion = 'unknown'; }
  ]) {
    const value = report(); mutate(value);
    assert.throws(() => validateNormalizedReport(value));
  }
});
