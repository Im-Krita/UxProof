import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareFindings } from '../comparison.mjs';

test('does not claim resolution when coverage is partial', () => {
  const before = { comparisonKey: 'same', status: 'completed', normalizedCoverage: { status: 'partial' }, normalizedFindings: [{ findingId: 'a' }, { findingId: 'b' }] };
  const after = { ...before, normalizedFindings: [{ findingId: 'a' }, { findingId: 'c' }] };
  assert.deepEqual(compareFindings(before, after), { comparable: true, findings: [
    { findingId: 'a', status: 'still-present' }, { findingId: 'b', status: 'unverified' }, { findingId: 'c', status: 'unverified' }
  ] });
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
