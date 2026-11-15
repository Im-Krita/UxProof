import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findingId, groupObservations, axeObservations, failedStepObservation } from '../findings.mjs';

test('finding ID is stable across runs and viewport observations', () => {
  const a = { ruleId: 'axe:color-contrast', anchor: ['.warning'], runId: 'a', viewport: 'mobile' };
  const b = { ...a, runId: 'b', viewport: 'desktop' };
  assert.equal(findingId(a), findingId(b));
  assert.notEqual(findingId(a), findingId({ ...a, anchor: ['.other'] }));
  assert.notEqual(findingId(a), findingId({ ...a, ruleId: 'axe:other' }));
});

test('groups observations by explicit identity and preserves each observation', () => {
  const observations = [
    { observationId: 'one', ruleId: 'axe:contrast', anchor: ['/', '.warning'], viewportId: 'mobile' },
    { observationId: 'two', ruleId: 'axe:contrast', anchor: ['/', '.warning'], viewportId: 'desktop' },
    { observationId: 'three', ruleId: 'axe:contrast', anchor: ['/', '.other'], viewportId: 'desktop' }
  ];
  const findings = groupObservations(observations);
  assert.equal(findings.length, 2);
  assert.deepEqual(findings[0].observations.map(item => item.observationId), ['one', 'two']);
  assert.equal(findings[1].observations[0].observationId, 'three');
  assert.throws(() => groupObservations([observations[0], observations[0]]), /observationId/);
});

test('missing identity evidence must not be silently merged', () => {
  assert.throws(() => findingId({ ruleId: 'axe:contrast', anchor: [] }));
  assert.throws(() => findingId({ ruleId: '', anchor: ['x'] }));
});

test('axe observations represent individual nodes and exclude URL query data', () => {
  const input = { violation: { id: 'color-contrast', nodes: [{ target: ['.one'] }, { target: ['.two'] }] },
    pageUrl: 'https://example.test/page?token=secret', scenarioId: 's', viewportId: 'v', runId: 'run' };
  const observations = axeObservations(input);
  assert.equal(observations.length, 2);
  assert.notEqual(observations[0].observationId, observations[1].observationId);
  assert.notEqual(findingId(observations[0]), findingId(observations[1]));
  assert.ok(!JSON.stringify(observations).includes('secret'));
  const again = axeObservations({ ...input, runId: 'another', viewportId: 'other' });
  assert.equal(findingId(observations[0]), findingId(again[0]));
  assert.equal(axeObservations({ ...input, violation: { id: 'x', nodes: [{ target: [] }] } }).length, 0);
});

test('failed step identity distinguishes scenarios and expectations without exposing values', () => {
  const step = { type: 'expectText', target: 'css:#status', value: 'private-expected-value' };
  const input = { pageUrl: 'https://example.test/page?token=secret', scenario: { id: 's', steps: [step] }, step, stepIndex: 0, scenarioId: 's', viewportId: 'mobile', runId: 'one' };
  const a = failedStepObservation(input);
  const b = failedStepObservation({ ...input, runId: 'two', viewportId: 'desktop' });
  assert.equal(findingId(a), findingId(b));
  assert.notEqual(a.observationId, b.observationId);
  assert.ok(!JSON.stringify(a).includes('private-expected-value'));
  assert.ok(!JSON.stringify(a).includes('secret'));
  const changed = { ...step, value: 'another value' };
  assert.notEqual(findingId(a), findingId(failedStepObservation({ ...input, step: changed, scenario: { ...input.scenario, steps: [changed] } })));
  assert.equal(failedStepObservation({ ...input, pageUrl: 'about:blank' }), null);
});
