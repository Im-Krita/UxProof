import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findingId } from '../findings.mjs';

test('finding ID is stable across runs and viewport observations', () => {
  const a = { ruleId: 'axe:color-contrast', anchor: ['.warning'], runId: 'a', viewport: 'mobile' };
  const b = { ...a, runId: 'b', viewport: 'desktop' };
  assert.equal(findingId(a), findingId(b));
  assert.notEqual(findingId(a), findingId({ ...a, anchor: ['.other'] }));
  assert.notEqual(findingId(a), findingId({ ...a, ruleId: 'axe:other' }));
});

test('missing identity evidence must not be silently merged', () => {
  assert.throws(() => findingId({ ruleId: 'axe:contrast', anchor: [] }));
  assert.throws(() => findingId({ ruleId: '', anchor: ['x'] }));
});
