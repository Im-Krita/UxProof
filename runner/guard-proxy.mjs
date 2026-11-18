import http from 'node:http';
import net from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { assertRequestAllowed, normalizeHost } from './policy.mjs';

function pinnedLookup(addresses) {
  return (_hostname, options, callback) => {
    const family = typeof options === 'number' ? options : options?.family || 0;
    const records = addresses.map(address => ({ address, family: net.isIP(address) })).filter(record => !family || record.family === family);
    queueMicrotask(() => {
      if (!records.length) { callback(Error('Нет разрешённого адреса нужного семейства')); return; }
      if (typeof options === 'object' && options.all) callback(null, records);
      else callback(null, records[0].address, records[0].family);
    });
  };
}

// Chromium is configured to route even loopback destinations here. Each connection
// uses the exact IP returned by the policy check, rather than resolving a second time.
export async function startGuardProxy({ baseUrl, basePolicy, onBlocked = () => {}, lookup, maxRequests = 10000, maxTunnelBytes = 32 * 1024 * 1024, maxTotalTunnelBytes = 128 * 1024 * 1024 }) {
  if (!Number.isInteger(maxRequests) || maxRequests < 1) throw Error('Недопустимый лимит сетевых запросов');
  if (!Number.isInteger(maxTunnelBytes) || maxTunnelBytes < 1 || !Number.isInteger(maxTotalTunnelBytes) || maxTotalTunnelBytes < 1) throw Error('Недопустимый лимит размера туннеля');
  const username = randomBytes(16).toString('hex');
  const password = randomBytes(24).toString('hex');
  const expected = Buffer.from(`Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`);
  // A private agent avoids inheriting a global environment proxy that could bypass IP pinning.
  const directAgent = new http.Agent({ keepAlive: false });
  const sockets = new Set();
  let closed = false;
  let requestCount = 0;
  const tunnelTotals = { bytes: 0 };
  const relayTunnel = (client, upstream, head) => {
    const state = { bytes: head.length, tripped: false };
    tunnelTotals.bytes += head.length;
    const stop = () => {
      if (state.tripped) return;
      state.tripped = true;
      blocked('Превышен лимит размера туннеля');
      client.destroy();
      upstream.destroy();
    };
    if (state.bytes > maxTunnelBytes || tunnelTotals.bytes > maxTotalTunnelBytes) { stop(); return; }
    const forward = (from, to) => {
      from.on('data', chunk => {
        state.bytes += chunk.length;
        tunnelTotals.bytes += chunk.length;
        if (state.bytes > maxTunnelBytes || tunnelTotals.bytes > maxTotalTunnelBytes) { stop(); return; }
        if (!to.write(chunk)) from.pause();
      });
    };
    forward(client, upstream);
    forward(upstream, client);
    client.on('drain', () => upstream.resume());
    upstream.on('drain', () => client.resume());
    if (head.length && !upstream.write(head)) client.pause();
  };
  const remember = socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    return socket;
  };
  const authorized = request => {
    const supplied = Buffer.from(String(request.headers['proxy-authorization'] || ''));
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  };
  const denyAuth = socket => {
    socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="UXProof"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  };
  const blocked = error => {
    try { onBlocked(String(error?.message || error).slice(0, 160)); } catch { /* reporting must not bypass policy */ }
  };
  const withinBudget = () => {
    if (requestCount >= maxRequests) { blocked('Превышен лимит сетевых запросов'); return false; }
    requestCount++;
    return true;
  };
  const resolveTarget = async target => {
    const addresses = await assertRequestAllowed(target, baseUrl, basePolicy.baseLoopback, lookup, basePolicy.addresses);
    if (!addresses.length) throw Error('Адрес назначения не разрешён');
    return addresses;
  };
  const server = http.createServer(async (request, response) => {
    if (!authorized(request)) {
      response.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="UXProof"', 'Content-Length': '0', Connection: 'close' });
      response.end();
      return;
    }
    if (!withinBudget()) { response.destroy(); return; }
    let url, addresses;
    try {
      url = new URL(request.url);
      if (url.protocol !== 'http:') throw Error('Разрешены только HTTP-запросы через прокси');
      addresses = await resolveTarget(url.href);
    } catch (error) {
      blocked(error);
      response.destroy();
      return;
    }
    if (closed) { response.destroy(); return; }
    const headers = { ...request.headers };
    delete headers['proxy-authorization'];
    delete headers['proxy-connection'];
    const upstream = http.request({ hostname: normalizeHost(url.hostname), port: Number(url.port || 80), method: request.method,
      path: `${url.pathname}${url.search}`, headers, agent: directAgent, lookup: pinnedLookup(addresses), autoSelectFamily: true }, upstreamResponse => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.on('error', () => response.destroy());
      upstreamResponse.on('aborted', () => response.destroy());
      upstreamResponse.pipe(response);
    });
    upstream.on('socket', remember);
    upstream.setTimeout(30000, () => upstream.destroy(new Error('Таймаут соединения')));
    upstream.on('error', () => {
      if (!response.headersSent) { response.writeHead(502, { 'Content-Length': '0', Connection: 'close' }); response.end(); }
      else response.destroy();
    });
    request.on('aborted', () => upstream.destroy());
    request.on('error', () => upstream.destroy());
    request.pipe(upstream);
  });
  server.maxConnections = 128;
  server.headersTimeout = 10000;
  server.requestTimeout = 30000;
  server.on('drop', () => blocked('Превышен лимит сетевых соединений'));
  server.on('connection', remember);
  server.on('connect', async (request, socket, head) => {
    if (!authorized(request)) { denyAuth(socket); return; }
    if (!withinBudget()) { socket.destroy(); return; }
    let url, addresses, port;
    try {
      const authority = String(request.url || '');
      const match = authority.match(/^(?:\[[0-9a-f:.]+\]|[^:/?#]+):(\d{1,5})$/i);
      port = Number(match?.[1]);
      if (!match || port < 1 || port > 65535) throw Error('Некорректный адрес туннеля');
      url = new URL(`https://${request.url}`);
      if (!url.hostname || url.pathname !== '/' || url.search || url.hash) throw Error('Некорректный адрес туннеля');
      addresses = await resolveTarget(url.href);
    } catch (error) {
      blocked(error);
      socket.destroy();
      return;
    }
    if (closed) { socket.destroy(); return; }
    const upstream = remember(net.connect({ host: normalizeHost(url.hostname), port, lookup: pinnedLookup(addresses), autoSelectFamily: true }));
    let connected = false;
    upstream.setTimeout(30000, () => upstream.destroy());
    upstream.once('connect', () => {
      connected = true;
      upstream.setTimeout(0);
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      relayTunnel(socket, upstream, head);
    });
    upstream.on('error', () => {
      if (!connected && !socket.destroyed) socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      else socket.destroy();
    });
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
  });
  // Plain WebSocket upgrade requests need the same destination check as HTTP.
  server.on('upgrade', async (request, socket, head) => {
    if (!authorized(request)) { denyAuth(socket); return; }
    if (!withinBudget()) { socket.destroy(); return; }
    let url, addresses;
    try {
      url = new URL(request.url);
      if (url.protocol !== 'http:') throw Error('Некорректный WebSocket-адрес');
      addresses = await resolveTarget(url.href);
    } catch (error) {
      blocked(error);
      socket.destroy();
      return;
    }
    if (closed) { socket.destroy(); return; }
    const upstream = remember(net.connect({ host: normalizeHost(url.hostname), port: Number(url.port || 80), lookup: pinnedLookup(addresses), autoSelectFamily: true }));
    upstream.setTimeout(30000, () => upstream.destroy());
    upstream.once('connect', () => {
      upstream.setTimeout(0);
      let header = `${request.method} ${url.pathname}${url.search} HTTP/${request.httpVersion}\r\n`;
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        const name = request.rawHeaders[index];
        if (!['proxy-authorization', 'proxy-connection'].includes(name.toLowerCase())) header += `${name}: ${request.rawHeaders[index + 1]}\r\n`;
      }
      upstream.write(`${header}\r\n`);
      relayTunnel(socket, upstream, head);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  return {
    server: `http://127.0.0.1:${server.address().port}`, username, password,
    close: async () => {
      if (closed) return;
      closed = true;
      directAgent.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  };
}
