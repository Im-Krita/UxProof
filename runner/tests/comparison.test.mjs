import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareFindings, comparisonKey, comparisonProfileKey } from '../comparison.mjs';
import { presentableFindings, recheckedSteps } from '../matching.mjs';

test('does not claim resolution when coverage is partial', () => {
  const before = { comparisonKey: 'same', normalizedSchemaVersion: '0.2', status: 'completed', normalizedCoverage: { status: 'partial' }, normalizedFindings: [{ findingId: 'a' }, { findingId: 'b' }] };
  const after = { ...before, normalizedFindings: [{ findingId: 'a' }, { findingId: 'c' }] };
  assert.deepEqual(compareFindings(before, after), { comparable: true, findings: [
    { findingId: 'a', status: 'still-present' }, { findingId: 'b', status: 'unverified' }, { findingId: 'c', status: 'new' }
  ] });
});

test('comparison key captures URL, scenarios, viewport and options, not run metadata', () => {
  const config = { baseUrl: 'http://localhost:4180/', scenarios: [{ id: 's', steps: [{ type: 'click', target: '#a' }] }], viewports: [{ id: 'd', width: 1440, height: 900 }], options: { enableAI: false }, runId: 'one' };
  assert.equal(comparisonKey(config), comparisonKey({ ...config, runId: 'two' }));
  assert.notEqual(comparisonKey(config), comparisonKey({ ...config, baseUrl: 'http://localhost:4180/fixed' }));
  assert.notEqual(comparisonKey(config), comparisonKey({ ...config, viewports: [{ id: 'd', width: 390, height: 844 }] }));
  assert.notEqual(comparisonKey(config), comparisonKey({ ...config, scenarios: [{ id: 's', steps: [{ type: 'click', target: '#b' }] }] }));
  assert.equal(comparisonProfileKey(config), comparisonProfileKey({ ...config, baseUrl: 'http://localhost:4180/fixed' }));
  assert.notEqual(comparisonProfileKey(config), comparisonProfileKey({ ...config, baseUrl: 'http://localhost:4181/fixed' }));
  assert.notEqual(comparisonProfileKey(config), comparisonProfileKey({ ...config, baseUrl: 'http://localhost:4180/fixed?variant=other' }));
});

test('explicit path mapping pairs only unambiguous exact rule and anchors within each base path', () => {
  const config = { baseUrl: 'http://localhost:4180/', scenarios: [], viewports: [], options: {} };
  const afterConfig = { ...config, baseUrl: 'http://localhost:4180/fixed' };
  const common = { normalizedSchemaVersion: '0.2', status: 'completed', normalizedCoverage: { status: 'partial' } };
  const before = { ...common, baseUrl: config.baseUrl, comparisonKey: comparisonKey(config), comparisonProfileKey: comparisonProfileKey(config), normalizedFindings: [
    { findingId: 'old', ruleId: 'axe:label', anchor: ['http://localhost:4180/', '#same'] },
    { findingId: 'moved', ruleId: 'axe:color', anchor: ['http://localhost:4180/', '#old'] },
    { findingId: 'other-page', ruleId: 'axe:label', anchor: ['http://localhost:4180/else', '#same'] }
  ] };
  const after = { ...common, baseUrl: afterConfig.baseUrl, comparisonKey: comparisonKey(afterConfig), comparisonProfileKey: comparisonProfileKey(afterConfig), normalizedFindings: [
    { findingId: 'new', ruleId: 'axe:label', anchor: ['http://localhost:4180/fixed', '#same'] },
    { findingId: 'moved-new', ruleId: 'axe:color', anchor: ['http://localhost:4180/fixed', '#new'] }
  ] };
  assert.equal(compareFindings(before, after).comparable, false);
  assert.deepEqual(compareFindings(before, after, { mapPaths: true }), { comparable: true, mappedPaths: true, findings: [
    { findingId: 'old', afterFindingId: 'new', status: 'still-present' },
    { findingId: 'moved', status: 'unverified' }, { findingId: 'other-page', status: 'unverified' },
    { findingId: 'moved-new', status: 'new' }
  ] });
  const duplicate = { ...after, normalizedFindings: [...after.normalizedFindings, { ...after.normalizedFindings[0], findingId: 'duplicate' }] };
  assert.ok(compareFindings(before, duplicate, { mapPaths: true }).findings.every(item => item.status === 'unverified' || item.status === 'new'));
  assert.equal(compareFindings(before, { ...after, baseUrl: 'http://other:4180/fixed' }, { mapPaths: true }).comparable, false);
  assert.equal(compareFindings(before, { ...after, comparisonProfileKey: 'different' }, { mapPaths: true }).comparable, false);
});

test('rejects incompatible or missing comparison keys', () => {
  assert.equal(compareFindings({ comparisonKey: 'a' }, { comparisonKey: 'b' }).comparable, false);
  assert.equal(compareFindings({}, {}).comparable, false);
});

test('even complete coverage does not resolve a potentially moved element', () => {
  const before = { comparisonKey: 'same', normalizedSchemaVersion: '0.2', status: 'completed', normalizedCoverage: { status: 'complete' }, normalizedFindings: [{ findingId: 'a' }] };
  const after = { ...before, normalizedFindings: [{ findingId: 'b' }] };
  assert.deepEqual(compareFindings(before, after).findings, [
    { findingId: 'a', status: 'unverified' }, { findingId: 'b', status: 'new' }
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
  const finding = { findingId: 'f', ruleId: 'playwright:step:expectText', anchor: ['http://example.test/', 'scenario:s', `definition:${'a'.repeat(64)}`, 'step:1'], observations: [
    { runId: 'old', source: 'playwright', scenarioId: 's', viewportId: 'v', stepId: '1' },
    { runId: 'old', source: 'playwright', scenarioId: 's', viewportId: 'mobile', stepId: '1' }
  ] };
  for (const observation of finding.observations) Object.assign(observation, { ruleId: finding.ruleId, anchor: finding.anchor, classification: 'technical-fact', status: 'confirmed' });
  const base = { comparisonKey: 'same', normalizedSchemaVersion: '0.2', status: 'completed', normalizedCoverage: { status: 'partial' }, scenarioEventsVersion: '0.1' };
  const event = (runId, viewportId, phase) => ({ eventId: `${runId}-${viewportId}-${phase}`, at: '2026-11-15T12:00:00.000Z', runId, scenarioId: 's', viewportId, stepId: '1', stepType: 'expectText', combinationId: viewportId, phase, ...(phase === 'error' ? { screenshot: null } : {}) });
  const before = { ...base, runId: 'old', normalizedFindings: [finding], results: ['v', 'mobile'].map(id => ({ id, steps: [{ index: 1, type: 'expectText', status: 'failed' }] })),
    scenarioEvents: ['v', 'mobile'].flatMap(v => ['before', 'action', 'error'].map(phase => event('old', v, phase))) };
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

test('resolves only a re-executed failed step on the same or explicitly mapped page', () => {
  const initialScopeId = `scope-${'a'.repeat(64)}`, otherScopeId = `scope-${'b'.repeat(64)}`, fixedScopeId = `scope-${'c'.repeat(64)}`;
  const finding = { findingId: 'f', ruleId: 'playwright:step:expectVisible', anchor: ['http://example.test/', 'scenario:s', `definition:${'b'.repeat(64)}`, 'step:1'],
    observations: [{ runId: 'old', source: 'playwright', scenarioId: 's', viewportId: 'v', stepId: '1' }] };
  Object.assign(finding.observations[0], { ruleId: finding.ruleId, anchor: finding.anchor, classification: 'technical-fact', status: 'confirmed' });
  const base = { comparisonKey: 'same', comparisonProfileKey: 'profile', normalizedSchemaVersion: '0.2', status: 'completed', normalizedCoverage: { status: 'partial' }, scenarioEventsVersion: '0.1' };
  const events = (runId, terminal, scope) => ['before', 'action', terminal].map(phase => ({ eventId: `${runId}-${phase}`, at: '2026-11-15T12:00:00.000Z', runId,
    combinationId: '0-0', scenarioId: 's', viewportId: 'v', stepId: '1', stepType: 'expectVisible', phase, ...(phase === 'error' ? { screenshot: null } : {}), ...(['after', 'error'].includes(phase) && scope ? { pageScopeId: scope } : {}) }));
  const before = { ...base, runId: 'old', baseUrl: 'http://example.test/', baseScopeId: initialScopeId, normalizedFindings: [finding], results: [{ id: '0-0', steps: [{ index: 1, type: 'expectVisible', status: 'failed' }] }], scenarioEvents: events('old', 'error', initialScopeId) };
  const after = { ...base, runId: 'new', baseUrl: 'http://example.test/', baseScopeId: initialScopeId, normalizedFindings: [], results: [{ id: '0-0', steps: [{ index: 1, type: 'expectVisible', status: 'passed' }] }], scenarioEvents: events('new', 'after', initialScopeId) };
  assert.equal(compareFindings(before, after).findings[0].status, 'resolved');
  const moved = structuredClone(after); moved.scenarioEvents[2].pageScopeId = otherScopeId;
  assert.equal(compareFindings(before, moved).findings[0].status, 'unverified');
  const historical = structuredClone(after); delete historical.scenarioEvents[2].pageScopeId; historical.scenarioEvents[2].pageScope = 'http://example.test/';
  assert.equal(compareFindings(before, historical).findings[0].status, 'unverified');
  const broken = structuredClone(before); broken.scenarioEvents[1].eventId = broken.scenarioEvents[0].eventId;
  assert.equal(compareFindings(broken, after).findings[0].status, 'unverified');
  const conflict = { ...after, normalizedFindings: [{ findingId: 'other', ruleId: finding.ruleId, anchor: finding.anchor }] };
  assert.equal(compareFindings(before, conflict).findings[0].status, 'unverified');
  const otherViewportFailed = structuredClone(after);
  otherViewportFailed.scenarioEvents.push({ ...otherViewportFailed.scenarioEvents[2], eventId: 'other-failure', viewportId: 'mobile', phase: 'error' });
  assert.equal(compareFindings(before, otherViewportFailed).findings[0].status, 'unverified');
  const mapped = { ...after, comparisonKey: 'other', baseUrl: 'http://example.test/fixed', baseScopeId: fixedScopeId, scenarioEvents: events('new', 'after', fixedScopeId) };
  assert.equal(compareFindings(before, mapped).comparable, false);
  assert.equal(compareFindings(before, mapped, { mapPaths: true }).findings[0].status, 'resolved');
});
