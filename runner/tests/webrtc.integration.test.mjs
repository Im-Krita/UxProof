import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import http from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { prepareBasePolicy } from '../policy.mjs';
import { startGuardProxy } from '../guard-proxy.mjs';

test('guarded Chromium suppresses direct WebRTC UDP when the control emits STUN', { timeout: 30000 }, async t => {
  const udp = dgram.createSocket('udp4');
  let packets = 0;
  udp.on('message', () => { packets++; });
  udp.bind(0, '127.0.0.1'); await once(udp, 'listening');
  const web = http.createServer((_req, res) => res.end('<!doctype html><title>fixture</title>'));
  web.listen(0, '127.0.0.1'); await once(web, 'listening');
  const base = `http://127.0.0.1:${web.address().port}/`;
  const proxy = await startGuardProxy({ baseUrl: base, basePolicy: await prepareBasePolicy(base) });
  const observe = async guarded => {
    const args = guarded ? ['--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] : [];
    const browser = await chromium.launch({ headless: true, args });
    try {
      const context = await browser.newContext(guarded ? { proxy: { server: proxy.server, username: proxy.username, password: proxy.password, bypass: '<-loopback>' } } : {});
      const page = await context.newPage();
      await page.goto(base);
      const before = packets;
      await page.evaluate(async port => {
        const peer = new RTCPeerConnection({ iceServers: [{ urls: `stun:127.0.0.1:${port}` }] });
        peer.createDataChannel('test');
        await peer.setLocalDescription(await peer.createOffer());
        await new Promise(resolve => setTimeout(resolve, 2500));
        peer.close();
      }, udp.address().port);
      return packets - before;
    } finally { await browser.close(); }
  };
  try {
    const direct = await observe(false);
    const guarded = await observe(true);
    if (direct === 0) { t.skip('Control did not emit local STUN packets in this environment'); return; }
    assert.equal(guarded, 0);
  } finally {
    await proxy.close();
    await new Promise(resolve => web.close(resolve));
    udp.close();
  }
});
