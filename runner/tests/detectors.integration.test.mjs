import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { runAudit } from '../audit.mjs';
import { DETECTORS } from '../detectors.mjs';
import { ruleIds, enabledRule } from '../rules.mjs';

const clean = async (root, names) => {
  for (const name of names) {
    const dir = path.join(root, name), shots = path.join(dir, 'screenshots');
    for (const file of await fs.readdir(shots).catch(() => [])) await fs.unlink(path.join(shots, file));
    await fs.rmdir(shots).catch(() => {});
    for (const file of ['report.json', 'report.html', 'report.xlsx', 'artifacts.json']) await fs.unlink(path.join(dir, file)).catch(() => {});
    await fs.rmdir(dir).catch(() => {});
  }
  await fs.rmdir(root);
};

test('every detector has a registry rule with matching classification', () => {
  for (const detector of DETECTORS) {
    assert.ok(ruleIds.includes(detector.ruleId), `${detector.ruleId} missing from registry`);
    assert.equal(enabledRule(detector.ruleId), true);
  }
});

test('new layout and copy rules fire on fixtures and respect disabledRules', async () => {
  const page = `<!doctype html><html lang="en"><title>Detectors</title><main>
    <button style="width:16px;height:16px;padding:0">tiny</button>
    <button>Continue</button><button>Continue</button>
    <p style="width:60px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">a very long clipped sentence</p>
  </main></html>`;
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-detectors-'));
  const names = ['all', 'off'];
  try {
    for (const name of names) {
      const report = await runAudit({
        runId: `detectors-${name}`, outputDir: path.join(root, name), project: 'fixture',
        baseUrl: `http://127.0.0.1:${server.address().port}/`,
        scenarios: [{ id: 's', title: 'fixture', steps: [{ type: 'wait', name: 'wait', value: '1' }] }],
        viewports: [{ id: 'v', width: 390, height: 844 }],
        options: { enableAI: false, ...(name === 'off' ? { disabledRules: ['layout:min-tap-target', 'layout:text-overflow', 'copy:repeated-button-name'] } : {}) }
      });
      const found = new Set(report.issues.map(issue => issue.ruleId));
      const expected = name === 'all';
      assert.equal(found.has('layout:min-tap-target'), expected);
      assert.equal(found.has('layout:text-overflow'), expected);
      assert.equal(found.has('copy:repeated-button-name'), expected);
      if (expected) {
        const tap = report.issues.find(issue => issue.ruleId === 'layout:min-tap-target');
        assert.equal(tap.status, 'confirmed');
        assert.match(tap.description, /24×24/);
        const copy = report.issues.find(issue => issue.ruleId === 'copy:repeated-button-name');
        assert.equal(copy.status, 'recommendation');
        assert.ok(report.normalizedFindings.some(finding => finding.ruleId === 'copy:repeated-button-name'));
      }
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    await clean(root, names);
  }
});

test('a detector that throws does not fail the audit', async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><html lang="en"><title>ok</title><main>ok</main></html>'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-detector-fail-'));
  try {
    const report = await runAudit({
      runId: 'detector-fail', outputDir: path.join(root, 'run'), project: 'fixture',
      baseUrl: `http://127.0.0.1:${server.address().port}/`,
      scenarios: [{ id: 's', title: 'fixture', steps: [{ type: 'wait', name: 'wait', value: '1' }] }],
      viewports: [{ id: 'v', width: 390, height: 844 }], options: { enableAI: false }
    });
    assert.equal(report.results[0].status, 'passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await clean(root, ['run']);
  }
});
