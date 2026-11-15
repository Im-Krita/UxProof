import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { prepareBasePolicy } from '../policy.mjs';
import { startGuardProxy } from '../guard-proxy.mjs';
import { chromium } from 'playwright';

const auth = proxy => `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}`;
const request = (proxy, target, authorization) => new Promise((resolve, reject) => {
  const address = new URL(proxy.server);
  const req = http.request({ host: address.hostname, port: address.port, path: target, agent: new http.Agent({ keepAlive: false }), headers: authorization ? { 'Proxy-Authorization': authorization } : {} }, res => {
    res.resume(); res.on('end', () => resolve(res.statusCode));
  });
  req.on('error', reject); req.end();
});

test('proxy connects directly even when Node global proxy is configured', async t => {
  if (typeof http.setGlobalProxyFromEnv !== 'function') { t.skip('Node does not support dynamic global proxy configuration'); return; }
  let targetHits = 0, decoyHits = 0;
  const target = http.createServer((_req, res) => { targetHits++; res.end('target'); });
  const decoy = http.createServer((_req, res) => { decoyHits++; res.end('decoy'); });
  target.listen(0, '127.0.0.1'); decoy.listen(0, '127.0.0.1');
  await Promise.all([once(target, 'listening'), once(decoy, 'listening')]);
  const base = `http://127.0.0.1:${target.address().port}/`;
  const restore = http.setGlobalProxyFromEnv({ http_proxy: `http://127.0.0.1:${decoy.address().port}`, no_proxy: '' });
  let proxy;
  try {
    await new Promise((resolve, reject) => { http.get(base, res => { res.resume(); res.on('end', resolve); }).on('error', reject); });
    assert.equal(decoyHits, 1, 'control must use the global proxy');
    proxy = await startGuardProxy({ baseUrl: base, basePolicy: await prepareBasePolicy(base) });
    assert.equal(await request(proxy, base, auth(proxy)), 200);
    assert.equal(targetHits, 1);
    assert.equal(decoyHits, 1);
  } finally {
    if (proxy) await proxy.close();
    restore();
    await Promise.all([new Promise(resolve => target.close(resolve)), new Promise(resolve => decoy.close(resolve))]);
  }
});

test('proxy requires credentials and pins validated DNS addresses', async () => {
  let hits = 0, calls = 0, forwardedProxyAuthorization;
  const target = http.createServer((req, res) => { hits++; forwardedProxyAuthorization = req.headers['proxy-authorization']; res.end('ok'); });
  target.listen(0, '127.0.0.1'); await once(target, 'listening');
  const base = `http://rebind.test:${target.address().port}/`;
  const lookup = async () => [{ address: ++calls <= 2 ? '127.0.0.1' : '127.0.0.2', family: 4 }];
  const policy = await prepareBasePolicy(base, lookup);
  const blocks = [];
  const proxy = await startGuardProxy({ baseUrl: base, basePolicy: policy, lookup, onBlocked: note => blocks.push(note) });
  try {
    assert.equal(await request(proxy, base), 407);
    assert.equal(hits, 0);
    assert.equal(await request(proxy, base, auth(proxy)), 200);
    assert.equal(hits, 1);
    assert.equal(forwardedProxyAuthorization, undefined);
    await assert.rejects(() => request(proxy, base, auth(proxy)));
    assert.equal(hits, 1);
    assert.ok(blocks.some(note => /изменил/i.test(note)));
  } finally {
    await proxy.close();
    await new Promise(resolve => target.close(resolve));
  }
});

test('public base cannot use proxy to reach a separate loopback service', async () => {
  let hits = 0;
  const target = http.createServer((_req, res) => { hits++; res.end('local'); });
  target.listen(0, '127.0.0.1'); await once(target, 'listening');
  const base = 'http://public-base.test/';
  const lookup = async () => [{ address: '1.1.1.1', family: 4 }];
  const proxy = await startGuardProxy({ baseUrl: base, basePolicy: await prepareBasePolicy(base, lookup), lookup });
  try {
    await assert.rejects(() => request(proxy, `http://127.0.0.1:${target.address().port}/`, auth(proxy)));
    assert.equal(hits, 0);
  } finally {
    await proxy.close();
    await new Promise(resolve => target.close(resolve));
  }
});

test('proxy can fall back among approved DNS addresses without a second lookup', async () => {
  const target = http.createServer((_req, res) => res.end('ok'));
  target.listen(0, '127.0.0.1'); await once(target, 'listening');
  const base = `http://multi-address.test:${target.address().port}/`;
  let calls = 0;
  const lookup = async () => { calls++; return [{ address: '127.0.0.2', family: 4 }, { address: '127.0.0.1', family: 4 }]; };
  const proxy = await startGuardProxy({ baseUrl: base, basePolicy: await prepareBasePolicy(base, lookup), lookup });
  try {
    assert.equal(await request(proxy, base, auth(proxy)), 200);
    assert.equal(calls, 2, 'the connection must use the already validated address set');
  } finally {
    await proxy.close();
    await new Promise(resolve => target.close(resolve));
  }
});

test('proxy stops forwarding after its request budget', async () => {
  let hits = 0;
  const target = http.createServer((_req, res) => { hits++; res.end('ok'); });
  target.listen(0, '127.0.0.1'); await once(target, 'listening');
  const base = `http://127.0.0.1:${target.address().port}/`;
  const blocks = [];
  const proxy = await startGuardProxy({ baseUrl: base, basePolicy: await prepareBasePolicy(base), maxRequests: 1, onBlocked: note => blocks.push(note) });
  try {
    assert.equal(await request(proxy, base, auth(proxy)), 200);
    await assert.rejects(() => request(proxy, base, auth(proxy)));
    assert.equal(hits, 1);
    assert.ok(blocks.some(note => /лимит сетевых запросов/i.test(note)));
  } finally {
    await proxy.close();
    await new Promise(resolve => target.close(resolve));
  }
});

test('CONNECT tunnels approved addresses and blocks metadata before connecting', async () => {
  const target = net.createServer(socket => socket.on('data', data => socket.write(data)));
  target.listen(0, '127.0.0.1'); await once(target, 'listening');
  const base = `http://127.0.0.1:${target.address().port}/`;
  const policy = await prepareBasePolicy(base);
  const proxy = await startGuardProxy({ baseUrl: base, basePolicy: policy });
  const address = new URL(proxy.server);
  const connect = targetAuthority => new Promise((resolve, reject) => {
    const req = http.request({ host: address.hostname, port: address.port, method: 'CONNECT', path: targetAuthority, headers: { 'Proxy-Authorization': auth(proxy) } });
    req.on('connect', (res, socket) => resolve({ res, socket }));
    req.on('error', reject); req.end();
  });
  try {
    const { res, socket } = await connect(`127.0.0.1:${target.address().port}`);
    assert.equal(res.statusCode, 200);
    const received = once(socket, 'data');
    socket.write('ping');
    assert.equal(String((await received)[0]), 'ping');
    socket.destroy();
    await assert.rejects(() => connect('169.254.169.254:80'));
  } finally {
    await proxy.close();
    await new Promise(resolve => target.close(resolve));
  }
});

test('Chromium cannot bypass an unavailable proxy for loopback addresses', async () => {
  let hits = 0;
  const target = http.createServer((_req, res) => { hits++; res.end('unsafe bypass'); });
  target.listen(0, '127.0.0.1'); await once(target, 'listening');
  const base = `http://127.0.0.1:${target.address().port}/`;
  const proxy = await startGuardProxy({ baseUrl: base, basePolicy: await prepareBasePolicy(base) });
  await proxy.close();
  const browser = await chromium.launch({ headless: true, args: ['--disable-quic'] });
  try {
    const context = await browser.newContext({ proxy: { server: proxy.server, username: proxy.username, password: proxy.password, bypass: '<-loopback>' } });
    const page = await context.newPage();
    await assert.rejects(() => page.goto(base, { timeout: 5000 }));
    assert.equal(hits, 0);
    await context.close();
  } finally {
    await browser.close();
    await new Promise(resolve => target.close(resolve));
  }
});
