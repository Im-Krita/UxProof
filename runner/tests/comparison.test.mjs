import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareFindings, comparisonKey } from '../comparison.mjs';
import { presentableFindings, recheckedSteps } from '../matching.mjs';

test('does not claim resolution when coverage is partial', () => {
  const before = { comparisonKey: 'same', normalizedSchemaVersion: '0.2', status: 'completed', normalizedCoverage: { status: 'partial' }, normalizedFindings: [{ findingId: 'a' }, { findingId: 'b' }] };
  const after = { ...before, normalizedFindings: [{ findingId: 'a' }, { findingId: 'c' }] };
  assert.deepEqual(compareFindings(before, after), { comparable: true, findings: [
    { findingId: 'a', status: 'still-present' }, { findingId: 'b', status: 'unverified' }, { findingId: 'c', status: 'unverified' }
  ] });
});

test('comparison key captures URL, scenarios, viewport and options, not run metadata', () => {
  const config = { baseUrl: 'http://localhost:4180/', scenarios: [{ id: 's', steps: [{ type: 'click', target: '#a' }] }], viewports: [{ id: 'd', width: 1440, height: 900 }], options: { enableAI: false }, runId: 'one' };
  assert.equal(comparisonKey(config), comparisonKey({ ...config, runId: 'two' }));
  assert.notEqual(comparisonKey(config), comparisonKey({ ...config, baseUrl: 'http://localhost:4180/fixed' }));
  assert.notEqual(comparisonKey(config), comparisonKey({ ...config, viewports: [{ id: 'd', width: 390, height: 844 }] }));
  assert.notEqual(comparisonKey(config), comparisonKey({ ...config, scenarios: [{ id: 's', steps: [{ type: 'click', target: '#b' }] }] }));
});

test('rejects incompatible or missing comparison keys', () => {
  assert.equal(compareFindings({ comparisonKey: 'a' }, { comparisonKey: 'b' }).comparable, false);
  assert.equal(compareFindings({}, {}).comparable, false);
});

test('even complete coverage does not resolve a potentially moved element', () => {
  const before = { comparisonKey: 'same', normalizedSchemaVersion: '0.2', status: 'completed', normalizedCoverage: { status: 'complete' }, normalizedFindings: [{ findingId: 'a' }] };
  const after = { ...before, normalizedFindings: [{ findingId: 'b' }] };
  assert.deepEqual(compareFindings(before, after).findings, [
    { findingId: 'a', status: 'unverified' }, { findingId: 'b', status: 'unverified' }
  ]);
  assert.equal(compareFindings(before, { ...after, normalizedFindings: [{ findingId: 'b' }, { findingId: 'b' }] }).comparable, false);
});

test('incomplete, mixed-version and malformed reports are not comparable', () => {
  const before = { comparisonKey: 'same', normalizedSchemaVersion: '0.2', status: 'completed', normalizedCoverage: { status: 'partial' }, normalizedFindings: [{ findingId: 'a' }] };
  assert.equal(compareFindings(before, { ...before, status: 'incomplete' }).comparable, false);
  assert.equal(compareFindings(before, { ...before, normalizedSchemaVersion: '0.1' }).comparable, false);
  assert.equal(compareFindings(before, { ...before, normalizedFindings: [null] }).comparable, false);
  assert.equal(compareFindings(before, { ...before, normalizedCoverage: null }).comparable, false);
});

test('presentable findings accept unknown rule IDs but reject foreign or unsafe evidence', () => {
  const report = { runId: 'run', normalizedSchemaVersion: '0.2', normalizedFindings: [{ findingId: 'f', ruleId: 'future:rule', observations: [
    { observationId: 'o', runId: 'run', scenarioId: 's', viewportId: 'v', source: 'future', evidence: { screenshot: 'run-1-1.png' } }
  ] }] };
  assert.equal(presentableFindings(report).length, 1);
  assert.equal(presentableFindings({ ...report, normalizedFindings: [null] }), null);
  const otherRun = structuredClone(report); otherRun.normalizedFindings[0].observations[0].runId = 'other';
  assert.equal(presentableFindings(otherRun), null);
  const traversal = structuredClone(report); traversal.normalizedFindings[0].observations[0].evidence.screenshot = '../secret.png';
  assert.equal(presentableFindings(traversal), null);
});

test('step recheck counts only matching passed executions without claiming resolution', () => {
  const finding = { findingId: 'f', ruleId: 'playwright:step:expectText', observations: [
    { runId: 'old', source: 'playwright', scenarioId: 's', viewportId: 'v', stepId: '1' },
    { runId: 'old', source: 'playwright', scenarioId: 's', viewportId: 'mobile', stepId: '1' }
  ] };
  const base = { comparisonKey: 'same', normalizedSchemaVersion: '0.2', status: 'completed', normalizedCoverage: { status: 'partial' }, scenarioEventsVersion: '0.1' };
  const event = (runId, viewportId, phase) => ({ runId, scenarioId: 's', viewportId, stepId: '1', stepType: 'expectText', combinationId: viewportId, phase });
  const before = { ...base, runId: 'old', normalizedFindings: [finding], scenarioEvents: [event('old', 'v', 'error'), event('old', 'mobile', 'error')] };
  const after = { ...base, runId: 'new', normalizedFindings: [], results: [{ id: 'v', steps: [{ index: 1, type: 'expectText', status: 'passed' }] }],
    scenarioEvents: ['before', 'action', 'after'].map(phase => event('new', 'v', phase)) };
  assert.deepEqual(recheckedSteps(before, after, finding), { passed: 1, total: 2 });
  assert.equal(compareFindings(before, after).findings[0].status, 'unverified');
  const corrupted = structuredClone(after); corrupted.scenarioEvents.pop();
  assert.deepEqual(recheckedSteps(before, corrupted, finding), { passed: 0, total: 2 });
  assert.equal(recheckedSteps(before, { ...after, comparisonKey: 'different' }, finding), null);
  assert.equal(recheckedSteps(before, { ...after, scenarioEventsVersion: undefined }, finding), null);
  const duplicated = structuredClone(finding); duplicated.observations.push(duplicated.observations[0]);
  assert.equal(recheckedSteps({ ...before, normalizedFindings: [duplicated] }, after, duplicated), null);
});
