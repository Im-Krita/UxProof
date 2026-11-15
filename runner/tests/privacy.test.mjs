import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { runAudit } from '../audit.mjs';

test('field assertion values do not appear in persisted JSON or HTML', async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<label for="field">Field</label><input id="field">'); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-privacy-test-'));
  try {
    const result = await runAudit({ runId: 'privacy-test', outputDir: dir, project: 'test', baseUrl: `http://127.0.0.1:${server.address().port}/`,
      scenarios: [{ id: 's', title: 'test', steps: [
        { type: 'fill', name: 'Fill', target: 'css:#field', value: 'actual-test-secret' },
        { type: 'expectValue', name: 'Check', target: 'css:#field', value: 'expected-test-secret' }
      ] }], viewports: [{ id: 'v', width: 390, height: 844 }], options: { enableAI: false } });
    assert.equal(result.results[0].status, 'failed');
    for (const filename of ['report.json', 'report.html', 'artifacts.json']) {
      const text = await fs.readFile(path.join(dir, filename), 'utf8');
      assert.ok(!text.includes('actual-test-secret'));
      assert.ok(!text.includes('expected-test-secret'));
    }
    assert.ok(result.results[0].screenshot);
  } finally {
    await new Promise(resolve => server.close(resolve));
    const shots = path.join(dir, 'screenshots');
    for (const file of await fs.readdir(shots).catch(() => [])) await fs.unlink(path.join(shots, file));
    await fs.rmdir(shots).catch(() => {});
    for (const file of ['report.json', 'report.html', 'artifacts.json']) await fs.unlink(path.join(dir, file)).catch(() => {});
    await fs.rmdir(dir);
  }
});

test('page exception messages are not persisted while the error remains visible', async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Test</title><script>throw new Error("exception-secret-92741")</script>'); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-pageerror-test-'));
  try {
    const result = await runAudit({ runId: 'privacy-pageerror', outputDir: dir, project: 'test', baseUrl: `http://127.0.0.1:${server.address().port}/`,
      scenarios: [{ id: 's', title: 'test', steps: [{ type: 'wait', name: 'wait', value: '100' }] }],
      viewports: [{ id: 'v', width: 390, height: 844 }], options: { enableAI: false } });
    assert.equal(result.issues.filter(issue => issue.kind === 'javascript').length, 1);
    for (const filename of ['report.json', 'report.html', 'artifacts.json']) {
      assert.ok(!(await fs.readFile(path.join(dir, filename), 'utf8')).includes('exception-secret-92741'));
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    const shots = path.join(dir, 'screenshots');
    for (const file of await fs.readdir(shots).catch(() => [])) await fs.unlink(path.join(shots, file));
    await fs.rmdir(shots).catch(() => {});
    for (const file of ['report.json', 'report.html', 'artifacts.json']) await fs.unlink(path.join(dir, file)).catch(() => {});
    await fs.rmdir(dir);
  }
});
