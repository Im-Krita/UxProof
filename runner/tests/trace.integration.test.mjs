import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { runAudit } from '../audit.mjs';

test('trace is opt-in, saved only for failures and included in the portable manifest', async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Trace</title><main id="state">actual</main>'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-trace-'));
  const names = ['default', 'passing', 'failing'];
  try {
    for (const name of names) {
      const report = await runAudit({ runId: `trace-${name}`, outputDir: path.join(root, name), project: 'fixture', baseUrl: `http://127.0.0.1:${server.address().port}/`,
        scenarios: [{ id: 's', title: 'fixture', steps: [{ type: 'expectText', name: 'check', target: 'css:#state', value: name === 'passing' ? 'actual' : 'missing' }] }],
        viewports: [{ id: 'v', width: 390, height: 844 }], options: { enableAI: false, ...(name !== 'default' ? { trace: 'on-failure' } : {}) } });
      if (name !== 'failing') {
        assert.equal(report.results[0].trace, undefined);
        assert.equal(await fs.stat(path.join(root, name, 'traces')).then(() => true, () => false), false);
        continue;
      }
      assert.equal(report.results[0].trace, 'traces/trace-1-1.zip');
      assert.ok(report.warnings.some(warning => /значения полей/.test(warning)));
      const bytes = await fs.readFile(path.join(root, name, ...report.results[0].trace.split('/')));
      assert.equal(bytes.subarray(0, 2).toString(), 'PK');
      const manifest = JSON.parse(await fs.readFile(path.join(root, name, 'artifacts.json'), 'utf8'));
      const entry = manifest.artifacts.find(item => item.path === report.results[0].trace);
      assert.equal(entry.bytes, bytes.length);
      assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.match(await fs.readFile(path.join(root, name, 'report.html'), 'utf8'), /traces\/trace-1-1\.zip/);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const name of names) {
      const dir = path.join(root, name), shots = path.join(dir, 'screenshots'), traces = path.join(dir, 'traces');
      for (const file of await fs.readdir(shots).catch(() => [])) await fs.unlink(path.join(shots, file));
      await fs.rmdir(shots).catch(() => {});
      for (const file of await fs.readdir(traces).catch(() => [])) await fs.unlink(path.join(traces, file));
      await fs.rmdir(traces).catch(() => {});
      for (const file of ['report.json', 'report.html', 'report.xlsx', 'artifacts.json']) await fs.unlink(path.join(dir, file)).catch(() => {});
      await fs.rmdir(dir).catch(() => {});
    }
    await fs.rmdir(root);
  }
});
