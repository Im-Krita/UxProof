import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateNormalizedReport } from '../report-contract.mjs';
import { axeObservations, countedObservation, groupObservations, failedStepObservation } from '../findings.mjs';

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

test('v0.3 accepts runtime, layout, copy and AI observations', () => {
  const value = report();
  value.normalizedSchemaVersion = '0.3';
  value.normalizedCoverage.sources = ['axe', 'runtime', 'layout', 'copy', 'ai'];
  const extras = [
    countedObservation({ pageUrl: 'https://example.test/', scenarioId: 's', viewportId: 'v', runId: 'r', ruleId: 'javascript:pageerror', source: 'runtime', classification: 'technical-fact', status: 'confirmed', token: 'count:1' }),
    countedObservation({ pageUrl: 'https://example.test/', scenarioId: 's', viewportId: 'v', runId: 'r', ruleId: 'layout:viewport-overflow', source: 'layout', classification: 'rule-violation', status: 'confirmed', token: 'overflow:1' }),
    countedObservation({ pageUrl: 'https://example.test/', scenarioId: 's', viewportId: 'v', runId: 'r', ruleId: 'copy:duplicate-heading', source: 'copy', classification: 'hypothesis', status: 'recommendation', token: 'groups:2' }),
    countedObservation({ pageUrl: 'https://example.test/', scenarioId: 's', viewportId: 'v', runId: 'r', ruleId: 'ai-ux:slot-1', source: 'ai', classification: 'hypothesis', status: 'recommendation', token: 'slot:1' })
  ];
  value.normalizedFindings.push(...groupObservations(extras));
  assert.equal(validateNormalizedReport(value), true);
  extras[3].status = 'confirmed';
  const confirmedAi = report();
  confirmedAi.normalizedSchemaVersion = '0.3';
  confirmedAi.normalizedCoverage.sources = ['axe', 'ai'];
  confirmedAi.normalizedFindings.push(...groupObservations([extras[3]]));
  assert.throws(() => validateNormalizedReport(confirmedAi));
});
