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
    assert.ok(result.scenarioEvents.at(-1).elementGeometry);
    assert.equal(result.scenarioEvents.at(-1).elementGeometry.deviceScaleFactor, 1);
    assert.ok(!JSON.stringify(result.scenarioEvents.at(-1).elementGeometry).includes('actual-test-secret'));
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

test('failure and final screenshots hide scenario values echoed into visible text', async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html lang="en"><title>Fixture</title><style>#echo{width:300px;height:30px}</style><label for="f">Value</label><input id="f"><div id="echo"></div><script>f.oninput=()=>echo.textContent="Echo: "+f.value</script></html>'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-echo-'));
  const names = ['alpha', 'bravo'];
  const originalFetch = globalThis.fetch, previousOllamaUrl = process.env.UXPROOF_OLLAMA_URL;
  const modelImages = [];
  process.env.UXPROOF_OLLAMA_URL = 'http://127.0.0.1:11434';
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    modelImages.push(Buffer.from(body.messages[1].images[0], 'base64'));
    return { ok: true, json: async () => ({ message: { content: '{"suggestions":[]}' } }) };
  };
  try {
    const images = [];
    for (const name of names) {
      const value = `private-${name}`;
      const report = await runAudit({ runId: `echo-${name}`, outputDir: path.join(root, name), project: 'fixture', baseUrl: `http://127.0.0.1:${server.address().port}/`,
        scenarios: [{ id: 's', title: 'fixture', steps: [{ type: 'fill', name: 'Fill', target: 'css:#f', value }, { type: 'expectValue', name: 'Check', target: 'css:#f', value: 'not-the-value' }] }],
        viewports: [{ id: 'v', width: 390, height: 844 }], options: { enableAI: true, aiProvider: 'ollama' } });
      const failed = report.results[0].steps.at(-1);
      assert.equal(failed.status, 'failed');
      images.push(await Promise.all([failed.screenshot, report.results[0].screenshot].map(file => fs.readFile(path.join(root, name, 'screenshots', file)))));
      for (const file of ['report.json', 'report.html']) assert.ok(!(await fs.readFile(path.join(root, name, file), 'utf8')).includes(value));
    }
    assert.deepEqual(images[0][0], images[1][0], 'failure screenshot must not expose echoed value');
    assert.deepEqual(images[0][1], images[1][1], 'final screenshot must not expose echoed value');
    assert.equal(modelImages.length, 2);
    assert.deepEqual(modelImages[0], images[0][1]);
    assert.deepEqual(modelImages[1], images[1][1]);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousOllamaUrl === undefined) delete process.env.UXPROOF_OLLAMA_URL; else process.env.UXPROOF_OLLAMA_URL = previousOllamaUrl;
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
