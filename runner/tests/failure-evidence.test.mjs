import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { runAudit } from '../audit.mjs';

test('a failed step has its own screenshot instead of the final run screenshot', async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><html lang="en"><title>Fixture</title><main id="state">actual</main></html>'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-step-evidence-'));
  try {
    const report = await runAudit({ runId: 'evidence-test', outputDir: dir, project: 'test', baseUrl: `http://127.0.0.1:${server.address().port}/`,
      scenarios: [{ id: 's', title: 'fixture', steps: [{ type: 'expectText', name: 'check', target: 'css:#state', value: 'missing' }] }],
      viewports: [{ id: 'v', width: 390, height: 844 }], options: { enableAI: false } });
    const result = report.results[0];
    const issue = report.issues.find(item => item.kind === 'functional' && item.step === 1);
    const observation = report.normalizedFindings.flatMap(f => f.observations).find(item => item.source === 'playwright');
    assert.equal(result.status, 'failed');
    assert.equal(result.steps[0].screenshot, 'error-1-1-1.png');
    assert.equal(issue.screenshot, result.steps[0].screenshot);
    assert.equal(observation.evidence.screenshot, result.steps[0].screenshot);
    assert.notEqual(result.screenshot, result.steps[0].screenshot);
    for (const filename of [result.screenshot, result.steps[0].screenshot]) assert.ok((await fs.stat(path.join(dir, 'screenshots', filename))).size > 100);
    assert.equal(report.artifactManifest, 'artifacts.json');
    const manifest = JSON.parse(await fs.readFile(path.join(dir, report.artifactManifest), 'utf8'));
    assert.ok(manifest.artifacts.some(item => item.path === `screenshots/${issue.screenshot}`));
    assert.match(await fs.readFile(path.join(dir, 'report.html'), 'utf8'), /screenshots\/error-1-1-1\.png/);
    const copy = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-portable-test-'));
    const copied = [];
    try {
      for (const item of manifest.artifacts) {
        const destination = path.resolve(copy, ...item.path.split('/'));
        assert.ok(destination.startsWith(copy + path.sep));
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(path.join(dir, ...item.path.split('/')), destination);
        copied.push(destination);
        const bytes = await fs.readFile(destination);
        assert.equal(bytes.length, item.bytes);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256);
      }
      await fs.copyFile(path.join(dir, 'artifacts.json'), path.join(copy, 'artifacts.json'));
      copied.push(path.join(copy, 'artifacts.json'));
    } finally {
      for (const file of copied) await fs.unlink(file).catch(() => {});
      await fs.rmdir(path.join(copy, 'screenshots')).catch(() => {});
      await fs.rmdir(copy);
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

test('a failed error screenshot is not replaced with a later screenshot', async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><html lang="en"><title>Fixture</title><main id="state">actual</main></html>'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-step-missing-'));
  const shots = path.join(dir, 'screenshots');
  await fs.mkdir(path.join(shots, 'error-1-1-1.png'), { recursive: true });
  try {
    const report = await runAudit({ runId: 'missing-evidence-test', outputDir: dir, project: 'test', baseUrl: `http://127.0.0.1:${server.address().port}/`,
      scenarios: [{ id: 's', title: 'fixture', steps: [{ type: 'expectText', name: 'check', target: 'css:#state', value: 'missing' }] }],
      viewports: [{ id: 'v', width: 390, height: 844 }], options: { enableAI: false } });
    const result = report.results[0];
    const issue = report.issues.find(item => item.kind === 'functional' && item.step === 1);
    const observation = report.normalizedFindings.flatMap(f => f.observations).find(item => item.source === 'playwright');
    assert.ok(result.screenshot, 'final screenshot should still be available');
    assert.equal(result.steps[0].screenshot, null);
    assert.equal(issue.screenshot, null);
    assert.equal(observation.evidence, undefined);
    assert.ok(report.warnings.some(warning => warning.includes('Скриншот ошибки')));
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rmdir(path.join(shots, 'error-1-1-1.png'));
    for (const file of await fs.readdir(shots)) await fs.unlink(path.join(shots, file));
    await fs.rmdir(shots);
    for (const file of ['report.json', 'report.html', 'artifacts.json']) await fs.unlink(path.join(dir, file)).catch(() => {});
    await fs.rmdir(dir);
  }
});

test('manifest write failure leaves an incomplete report instead of a false manifest link', async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><html lang="en"><title>Fixture</title><main id="state">ready</main></html>'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-manifest-failure-'));
  await fs.mkdir(path.join(dir, 'artifacts.json'));
  try {
    const report = await runAudit({ runId: 'manifest-failure-test', outputDir: dir, project: 'test', baseUrl: `http://127.0.0.1:${server.address().port}/`,
      scenarios: [{ id: 's', title: 'fixture', steps: [{ type: 'expectVisible', name: 'check', target: 'css:#state' }] }],
      viewports: [{ id: 'v', width: 390, height: 844 }], options: { enableAI: false } });
    assert.equal(report.status, 'incomplete');
    assert.equal(report.artifactManifest, undefined);
    assert.ok(report.warnings.some(warning => warning.includes('manifest')));
    const persisted = JSON.parse(await fs.readFile(path.join(dir, 'report.json'), 'utf8'));
    assert.equal(persisted.status, 'incomplete');
    assert.equal(persisted.artifactManifest, undefined);
  } finally {
    await new Promise(resolve => server.close(resolve));
    const shots = path.join(dir, 'screenshots');
    for (const file of await fs.readdir(shots).catch(() => [])) await fs.unlink(path.join(shots, file));
    await fs.rmdir(shots).catch(() => {});
    await fs.rmdir(path.join(dir, 'artifacts.json'));
    for (const file of ['report.json', 'report.html']) await fs.unlink(path.join(dir, file)).catch(() => {});
    await fs.rmdir(dir);
  }
});
