import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateNormalizedReport } from '../report-contract.mjs';

const fixture = version => JSON.parse(readFileSync(new URL(`../schemas/normalized-report-v${version}.schema.json`, import.meta.url), 'utf8'));

test('every shipped normalized schema declares the version the contract accepts', () => {
  for (const version of ['0.1', '0.2', '0.3']) {
    const schema = fixture(version);
    assert.equal(schema.properties?.normalizedSchemaVersion?.const, version, `schema ${version}`);
    assert.ok(schema.required?.includes('normalizedSchemaVersion'), `schema ${version} requires the version`);
    assert.ok(schema.required?.includes('normalizedFindings'), `schema ${version} requires findings`);
  }
});

test('strict validation stays opt-in: unknown future versions are rejected only on request', () => {
  const future = { normalizedSchemaVersion: '9.9', runId: 'r', normalizedCoverage: { status: 'partial', sources: ['axe'] }, normalizedFindings: [] };
  assert.throws(() => validateNormalizedReport(future), TypeError);
  // Reports without the extension are legacy and never rejected.
  assert.equal(validateNormalizedReport({ runId: 'r', issues: [] }), true);
});
