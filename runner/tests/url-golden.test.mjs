import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertBaseUrlShape, navigateDecision } from '../../shared/policy-core.mjs';
import { validateConfig } from '../validators.mjs';

const golden = JSON.parse(readFileSync(new URL('../../shared/url-golden.json', import.meta.url), 'utf8'));
const LIMITS = JSON.parse(readFileSync(new URL('../schemas/audit-config-limits.json', import.meta.url), 'utf8'));
const BASE = 'http://127.0.0.1:4180/';

const configWith = baseUrl => ({
  project: 'golden',
  baseUrl,
  scenarios: [{ id: 's', title: 't', steps: [{ type: 'expectVisible', name: 'n', target: 'css:main', value: '' }] }],
  viewports: [{ id: 'desktop', label: 'Desktop', width: 1440, height: 900 }],
  options: { enableAI: false }
});

const navigateConfig = value => ({
  ...configWith(BASE),
  scenarios: [{ id: 's', title: 't', steps: [{ type: 'navigate', name: 'go', target: '', value }] }]
});

function uiBase(baseUrl) {
  try { assertBaseUrlShape(baseUrl); return 'accept'; } catch { return 'reject'; }
}

test('golden baseUrl table matches the UI policy and the runner validator', () => {
  for (const row of golden.baseUrl) {
    assert.equal(uiBase(row.url), row.ui, `ui/base ${row.id}`);
    let node = 'accept';
    try { validateConfig(configWith(row.url)); } catch { node = 'reject'; }
    assert.equal(node, row.node, `node/base ${row.id}`);
  }
});

test('golden navigate table matches UI decision and the runner validator', () => {
  for (const row of golden.navigate) {
    const ui = navigateDecision(BASE, row.value).allow ? 'accept' : 'reject';
    assert.equal(ui, row.ui, `ui/navigate ${row.id}`);
    let node = 'accept';
    try { validateConfig(navigateConfig(row.value)); } catch { node = 'reject'; }
    assert.equal(node, row.node, `node/navigate ${row.id}`);
  }
});

test('golden table covers the limits actually used by the runner', () => {
  assert.equal(LIMITS.stepTypes.length, 10);
  assert.ok(golden.baseUrl.length >= 12 && golden.navigate.length >= 5);
});
