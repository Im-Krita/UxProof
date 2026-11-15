import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { runAudit } from '../audit.mjs';

test('viewport rule detects overflow, respects disable option and accepts a fitting page', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><html lang="en"><title>Layout</title><main style="width:${req.url === '/wide' ? '700px' : '100%'}">Fixture</main></html>`);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-rules-'));
  const names = ['wide', 'disabled', 'fit'];
  try {
    for (const name of names) {
      const config = { runId: `rules-${name}`, outputDir: path.join(root, name), project: 'fixture', baseUrl: `http://127.0.0.1:${server.address().port}/${name === 'fit' ? 'fit' : 'wide'}`,
        scenarios: [{ id: 's', title: 'fixture', steps: [{ type: 'wait', name: 'wait', value: '1' }] }],
        viewports: [{ id: 'v', width: 390, height: 844 }], options: { enableAI: false, ...(name === 'disabled' ? { disabledRules: ['layout:viewport-overflow'] } : {}) } };
      const report = await runAudit(config);
      const findings = report.issues.filter(issue => issue.ruleId === 'layout:viewport-overflow');
      assert.equal(findings.length, name === 'wide' ? 1 : 0);
      if (name === 'disabled') assert.deepEqual(report.options.disabledRules, ['layout:viewport-overflow']);
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
