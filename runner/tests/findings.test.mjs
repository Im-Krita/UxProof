import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findingId, groupObservations } from '../findings.mjs';

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
