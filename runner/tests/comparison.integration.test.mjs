import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { runAudit } from '../audit.mjs';
import { compareFindings } from '../../shared/matching.mjs';
import { scopeIdentifier } from '../findings.mjs';

test('real step failure resolves only after passing on the explicitly mapped page', async () => {
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><html lang="en"><title>Fixture</title><main id="state">${req.url.startsWith('/fixed') ? 'expected' : 'actual'}</main></html>`); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-compare-'));
  const names = ['before', 'after'];
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const reports = [];
    for (const name of names) {
      reports.push(await runAudit({ runId: `compare-${name}`, outputDir: path.join(root, name), project: 'fixture',
        baseUrl: `${base}/${name === 'after' ? 'fixed' : 'broken'}?mode=test#view`,
        scenarios: [{ id: 's', title: 'fixture', steps: [{ type: 'expectText', name: 'check', target: 'css:#state', value: 'expected' }] }],
        viewports: [{ id: 'v', width: 390, height: 844 }], options: { enableAI: false } }));
    }
    const [before, after] = reports;
    assert.equal(before.scenarioEvents.at(-1).pageScopeId, scopeIdentifier(`${base}/broken`));
    assert.equal(after.scenarioEvents.at(-1).pageScopeId, scopeIdentifier(`${base}/fixed`));
    assert.ok(!JSON.stringify(before.scenarioEvents).includes('/broken'));
    const finding = before.normalizedFindings.find(item => item.ruleId === 'playwright:step:expectText');
    assert.ok(finding);
    assert.equal(compareFindings(before, after).comparable, false);
    assert.equal(compareFindings(before, after, { mapPaths: true }).findings.find(item => item.findingId === finding.findingId).status, 'resolved');
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const name of names) {
      const dir = path.join(root, name), shots = path.join(dir, 'screenshots');
      for (const file of await fs.readdir(shots).catch(() => [])) await fs.unlink(path.join(shots, file));
      await fs.rmdir(shots).catch(() => {});
      for (const file of ['report.json', 'report.html', 'artifacts.json']) await fs.unlink(path.join(dir, file)).catch(() => {});
      await fs.rmdir(dir).catch(() => {});
    }
    await fs.rmdir(root);
  }
});
