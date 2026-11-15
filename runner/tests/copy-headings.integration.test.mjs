import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { runAudit } from '../audit.mjs';

test('duplicate heading is a screenshot-linked rule hypothesis, not an AI result or confirmed defect', async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html lang="en"><title>Fixture</title><main><h1>synthetic-secret-heading-589</h1><h2>synthetic-secret-heading-589</h2></main></html>'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-copy-'));
  const names = ['enabled', 'disabled'];
  try {
    for (const name of names) {
      const report = await runAudit({ runId: `copy-${name}`, outputDir: path.join(root, name), project: 'fixture', baseUrl: `http://127.0.0.1:${server.address().port}/`,
        scenarios: [{ id: 's', title: 'fixture', steps: [{ type: 'wait', name: 'wait', value: '1' }] }],
        viewports: [{ id: 'v', width: 390, height: 844 }], options: { enableAI: false, ...(name === 'disabled' ? { disabledRules: ['copy:duplicate-heading'] } : {}) } });
      const issues = report.issues.filter(item => item.ruleId === 'copy:duplicate-heading');
      assert.equal(issues.length, name === 'enabled' ? 1 : 0);
      assert.equal(report.summary.aiSuggestions, 0);
      assert.equal(report.summary.ruleSuggestions, name === 'enabled' ? 1 : 0);
      if (issues.length) {
        assert.equal(issues[0].status, 'recommendation');
        assert.ok(issues[0].screenshot);
        assert.ok((await fs.stat(path.join(root, name, 'screenshots', issues[0].screenshot))).isFile());
      }
      for (const file of ['report.json', 'report.html']) assert.ok(!(await fs.readFile(path.join(root, name, file), 'utf8')).includes('synthetic-secret-heading-589'));
    }
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
