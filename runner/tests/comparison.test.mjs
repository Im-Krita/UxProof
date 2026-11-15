import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareFindings, comparisonKey } from '../comparison.mjs';

test('does not claim resolution when coverage is partial', () => {
  const before = { comparisonKey: 'same', status: 'completed', normalizedCoverage: { status: 'partial' }, normalizedFindings: [{ findingId: 'a' }, { findingId: 'b' }] };
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
  const before = { comparisonKey: 'same', status: 'completed', normalizedCoverage: { status: 'complete' }, normalizedFindings: [{ findingId: 'a' }] };
  const after = { ...before, normalizedFindings: [{ findingId: 'b' }] };
  assert.deepEqual(compareFindings(before, after).findings, [
    { findingId: 'a', status: 'unverified' }, { findingId: 'b', status: 'unverified' }
  ]);
  assert.equal(compareFindings(before, { ...after, normalizedFindings: [{ findingId: 'b' }, { findingId: 'b' }] }).comparable, false);
});
