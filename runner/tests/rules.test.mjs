import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateRegistry, validateDisabledRules, viewportOverflow } from '../rules.mjs';

test('registry validates versioned rule metadata and rejects inconsistent inputs', async () => {
  const registry = JSON.parse(await readFile(new URL('../rules/registry-v0.1.json', import.meta.url), 'utf8'));
  assert.equal(validateRegistry(registry), true);
  const duplicate = structuredClone(registry); duplicate.rules.push(duplicate.rules[0]);
  assert.throws(() => validateRegistry(duplicate));
  const invalid = structuredClone(registry); invalid.rules[0].trigger.toleranceCssPx = -1;
  assert.throws(() => validateRegistry(invalid));
  assert.throws(() => validateDisabledRules(['unknown:rule']));
  assert.throws(() => validateDisabledRules(['layout:viewport-overflow', 'layout:viewport-overflow']));
});

test('overflow rule uses measured widths, tolerance and explicit disable list', () => {
  assert.equal(viewportOverflow({ actual: 393, expected: 390 }), null);
  assert.equal(viewportOverflow({ actual: 394, expected: 390 }).ruleId, 'layout:viewport-overflow');
  assert.equal(viewportOverflow({ actual: 700, expected: 390 }, ['layout:viewport-overflow']), null);
  assert.equal(viewportOverflow({ actual: '700', expected: 390 }), null);
  assert.equal(viewportOverflow({ actual: Infinity, expected: 390 }), null);
});
