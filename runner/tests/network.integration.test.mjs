import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { runAudit } from '../audit.mjs';

test('browser aborts redirects to cloud metadata addresses', async () => {
  let initialRequests = 0;
  const server = http.createServer((_req, res) => { initialRequests++; res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' }); res.end(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-redirect-test-'));
  try {
    const report = await runAudit({ runId: 'redirect-test', outputDir: dir, project: 'test', baseUrl: `http://127.0.0.1:${server.address().port}/`,
      scenarios: [{ id: 's', title: 'redirect', steps: [{ type: 'wait', name: 'wait', value: '1' }] }],
      viewports: [{ id: 'v', width: 390, height: 844 }], options: { enableAI: false } });
    assert.equal(report.results[0].status, 'failed');
    assert.ok(report.warnings.some(warning => warning.includes('Заблокирован запрос')));
    assert.ok(initialRequests > 0, 'the initial permitted request must reach the fixture');
  } finally {
    await new Promise(resolve => server.close(resolve));
    const shots = path.join(dir, 'screenshots');
    for (const file of await fs.readdir(shots).catch(() => [])) await fs.unlink(path.join(shots, file));
    await fs.rmdir(shots).catch(() => {});
    for (const file of ['report.json', 'report.html', 'artifacts.json']) await fs.unlink(path.join(dir, file)).catch(() => {});
    await fs.rmdir(dir);
  }
});

test('permitted redirects, cookies, POST and WebSockets still work through the proxy', async () => {
  let cookie = '', body = '', upgrades = 0;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/') { res.writeHead(302, { Location: '/final', 'Set-Cookie': 'sid=synthetic; Path=/; HttpOnly' }); res.end(); return; }
    if (req.url === '/final') {
      cookie = req.headers.cookie || '';
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><html lang="en"><title>Fixture</title><main id="status">loading</main><script>Promise.all([fetch("/submit",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({test:true})}).then(r=>r.text()),new Promise(resolve=>{const ws=new WebSocket(`ws://${location.host}/ws`);ws.onmessage=e=>{resolve(e.data);ws.close()}})]).then(v=>document.querySelector("#status").textContent=v.join("-")+location.pathname)</script></html>');
      return;
    }
    if (req.url === '/submit') {
      for await (const chunk of req) body += chunk;
      res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('done'); return;
    }
    res.writeHead(404); res.end();
  });
  server.on('upgrade', (req, socket) => {
    upgrades++;
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.write(Buffer.concat([Buffer.from([0x81, 5]), Buffer.from('ready')]));
    socket.on('error', () => {});
    socket.on('data', () => socket.end());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-redirect-ok-'));
  try {
    const report = await runAudit({ runId: 'redirect-ok', outputDir: dir, project: 'test', baseUrl: `http://127.0.0.1:${server.address().port}/`,
      scenarios: [{ id: 's', title: 'redirect', steps: [{ type: 'wait', name: 'wait', value: '1000' }, { type: 'expectText', name: 'done', target: 'css:#status', value: 'done-ready/final' }] }],
      viewports: [{ id: 'v', width: 390, height: 844 }], options: { enableAI: false } });
    assert.equal(report.results[0].status, 'passed');
    assert.match(cookie, /sid=synthetic/);
    assert.equal(body, '{"test":true}');
    assert.ok(upgrades > 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    const shots = path.join(dir, 'screenshots');
    for (const file of await fs.readdir(shots).catch(() => [])) await fs.unlink(path.join(shots, file));
    await fs.rmdir(shots).catch(() => {});
    for (const file of ['report.json', 'report.html', 'artifacts.json']) await fs.unlink(path.join(dir, file)).catch(() => {});
    await fs.rmdir(dir);
  }
});

test('a cross-origin redirect stops subsequent scripted actions', async () => {
  let targetHits = 0, actionHits = 0;
  const target = http.createServer((req, res) => {
    if (req.url === '/action') { actionHits++; res.end('action'); return; }
    targetHits++;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>Other origin</title><button id="action" onclick="fetch(\'/action\')">Action</button>');
  });
  target.listen(0, '127.0.0.1'); await once(target, 'listening');
  const origin = http.createServer((_req, res) => { res.writeHead(302, { Location: `http://127.0.0.1:${target.address().port}/` }); res.end(); });
  origin.listen(0, '127.0.0.1'); await once(origin, 'listening');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-cross-origin-'));
  try {
    const report = await runAudit({ runId: 'cross-origin-test', outputDir: dir, project: 'test', baseUrl: `http://127.0.0.1:${origin.address().port}/`,
      scenarios: [{ id: 's', title: 'redirect', steps: [{ type: 'click', name: 'action', target: 'css:#action' }] }],
      viewports: [{ id: 'v', width: 390, height: 844 }], options: { enableAI: false, trace: 'on-failure' } });
    assert.ok(targetHits > 0, 'fixture proves the redirect reached the other origin before detection');
    assert.equal(report.results[0].status, 'failed');
    assert.equal(report.status, 'incomplete');
    assert.equal(report.results[0].screenshot, null);
    assert.equal(report.results[0].trace, undefined);
    assert.equal(actionHits, 0);
    assert.ok(report.warnings.some(warning => /после загрузки/.test(warning)));
  } finally {
    await Promise.all([new Promise(resolve => origin.close(resolve)), new Promise(resolve => target.close(resolve))]);
    const shots = path.join(dir, 'screenshots');
    for (const file of await fs.readdir(shots).catch(() => [])) await fs.unlink(path.join(shots, file));
    await fs.rmdir(shots).catch(() => {});
    for (const file of ['report.json', 'report.html', 'artifacts.json']) await fs.unlink(path.join(dir, file)).catch(() => {});
    await fs.rmdir(dir);
  }
});

test('a click that navigates outside the project stops the following step', async () => {
  let actionHits = 0, targetHits = 0;
  const target = http.createServer((req, res) => {
    targetHits++;
    if (req.url === '/action') { actionHits++; res.end('action'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>Other origin</title><button id="action" onclick="fetch(\'/action\')">Action</button>');
  });
  target.listen(0, '127.0.0.1'); await once(target, 'listening');
  const origin = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><title>Origin</title><button id="go" onclick="location.href='http://127.0.0.1:${target.address().port}/'">Go</button>`);
  });
  origin.listen(0, '127.0.0.1'); await once(origin, 'listening');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-cross-click-'));
  try {
    const report = await runAudit({ runId: 'cross-click-test', outputDir: dir, project: 'test', baseUrl: `http://127.0.0.1:${origin.address().port}/`,
      scenarios: [{ id: 's', title: 'click', steps: [
        { type: 'click', name: 'go', target: 'css:#go' }, { type: 'click', name: 'action', target: 'css:#action' }
      ] }], viewports: [{ id: 'v', width: 390, height: 844 }], options: { enableAI: false } });
    assert.equal(report.status, 'incomplete');
    assert.equal(report.results[0].status, 'failed');
    assert.equal(report.results[0].steps.length, 1);
    assert.equal(report.results[0].screenshot, null);
    assert.equal(actionHits, 0);
    assert.equal(targetHits, 0);
    assert.ok(report.warnings.some(warning => /заблокирован до загрузки/.test(warning)));
  } finally {
    await Promise.all([new Promise(resolve => origin.close(resolve)), new Promise(resolve => target.close(resolve))]);
    const shots = path.join(dir, 'screenshots');
    for (const file of await fs.readdir(shots).catch(() => [])) await fs.unlink(path.join(shots, file));
    await fs.rmdir(shots).catch(() => {});
    for (const file of ['report.json', 'report.html', 'artifacts.json']) await fs.unlink(path.join(dir, file)).catch(() => {});
    await fs.rmdir(dir);
  }
});
