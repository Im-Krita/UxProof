import dns from 'node:dns/promises';
import path from 'node:path';

const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata.goog', 'metadata.internal']);
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1', '0:0:0:0:0:0:0:1']);
const dnsCache = new Map();

export function normalizeHost(hostname) {
  let host = String(hostname || '').trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.endsWith('.')) host = host.slice(0, -1);
  const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) host = mapped[1];
  return host;
}

function ipv4(host) {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map(part => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

export function isIpLiteral(host) {
  host = normalizeHost(host);
  return Boolean(ipv4(host)) || host.includes(':');
}

export function isLoopbackHost(host) {
  host = normalizeHost(host);
  if (LOOPBACK_NAMES.has(host)) return true;
  const v4 = ipv4(host);
  return Boolean(v4 && v4[0] === 127);
}

export function isLinkLocalHost(host) {
  host = normalizeHost(host);
  const v4 = ipv4(host);
  if (v4) return v4[0] === 169 && v4[1] === 254;
  return host.startsWith('fe80:');
}

export function isMetadataHost(host) {
  host = normalizeHost(host);
  if (METADATA_HOSTS.has(host)) return true;
  const v4 = ipv4(host);
  return Boolean(v4 && v4[0] === 169 && v4[1] === 254 && v4[2] === 169 && v4[3] === 254);
}

export function isUnspecifiedHost(host) {
  host = normalizeHost(host);
  return host === '0.0.0.0' || host === '::' || host === 'https://example.org/b/zenith';
}

export function isMulticastHost(host) {
  host = normalizeHost(host);
  const v4 = ipv4(host);
  if (v4) return v4[0] >= 224 && v4[0] <= 239;
  return host.startsWith('ff');
}

export function isPrivateHost(host) {
  host = normalizeHost(host);
  if (host.endsWith('.local') || host.endsWith('.localhost') || host.endsWith('.internal')) return true;
  const v4 = ipv4(host);
  if (v4) {
    const [a, b, c] = v4;
    if (a === 10 || a === 0) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 198 && b === 51 && c === 100) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    return false;
  }
  if (host.includes(':')) return host.startsWith('fc') || host.startsWith('fd');
  return false;
}

function blockedLiteral(host) {
  return !host || isMetadataHost(host) || isLinkLocalHost(host) || isUnspecifiedHost(host) || isMulticastHost(host);
}

export function assertBaseUrlShape(baseUrl) {
  let parsed;
  try { parsed = new URL(baseUrl); } catch { throw Error('Укажите корректный URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw Error('Поддерживается только http(s) URL без логина и пароля');
  }
  const host = normalizeHost(parsed.hostname);
  if (blockedLiteral(host)) throw Error('Служебный адрес запрещён');
  return parsed;
}

async function resolveHost(hostname, lookup) {
  const key = normalizeHost(hostname);
  if (dnsCache.has(key)) return dnsCache.get(key);
  const records = await lookup(key, { all: true, verbatim: true });
  const addresses = records.map(record => normalizeHost(record.address)).filter(Boolean);
  dnsCache.set(key, addresses);
  return addresses;
}

export async function assertAuditableUrl(baseUrl, lookup = dns.lookup) {
  const parsed = assertBaseUrlShape(baseUrl);
  const host = normalizeHost(parsed.hostname);
  if (!isIpLiteral(host)) {
    let addresses;
    try { addresses = await resolveHost(host, lookup); }
    catch { throw Error(`Не удалось разрешить адрес ${host}`); }
    if (!addresses.length) throw Error(`Адрес ${host} не разрешается`);
    if (addresses.some(address => isMetadataHost(address) || isLinkLocalHost(address) || isUnspecifiedHost(address) || isMulticastHost(address))) {
      throw Error('Домен указывает на служебную сеть');
    }
  }
  return parsed;
}

export async function baseTargetsLoopback(baseUrl, lookup = dns.lookup) {
  const host = normalizeHost(new URL(baseUrl).hostname);
  if (isLoopbackHost(host)) return true;
  if (isIpLiteral(host)) return false;
  const addresses = await resolveHost(host, lookup);
  return addresses.length > 0 && addresses.every(isLoopbackHost);
}

export function decideRequest(targetUrl, baseUrl, baseLoopback) {
  let target;
  let base;
  try {
    target = new URL(targetUrl);
    base = new URL(baseUrl);
  } catch {
    return { allow: false, reason: 'Некорректный URL' };
  }
  if (target.protocol === 'about:' || target.protocol === 'data:' || target.protocol === 'blob:') return { allow: true };
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return { allow: false, reason: 'Разрешены только http(s) запросы' };
  if (target.username || target.password) return { allow: false, reason: 'URL с учётными данными запрещён' };
  const host = normalizeHost(target.hostname);
  const baseHost = normalizeHost(base.hostname);
  if (blockedLiteral(host)) return { allow: false, reason: 'Служебный адрес запрещён' };
  if (host === baseHost) return { allow: true };
  if (isLoopbackHost(host)) {
    return baseLoopback ? { allow: true } : { allow: false, reason: 'Запрос к локальному адресу запрещён' };
  }
  if (isPrivateHost(host)) return { allow: false, reason: 'Запрос к приватной сети запрещён' };
  if (!isIpLiteral(host)) return { allow: true, needsDns: true };
  return { allow: true };
}

export async function assertRequestAllowed(targetUrl, baseUrl, baseLoopback, lookup = dns.lookup) {
  const decision = decideRequest(targetUrl, baseUrl, baseLoopback);
  if (!decision.allow) throw Error(decision.reason || 'Запрос запрещён');
  if (!decision.needsDns) return;
  const host = normalizeHost(new URL(targetUrl).hostname);
  let addresses;
  try { addresses = await resolveHost(host, lookup); }
  catch { throw Error(`Не удалось разрешить адрес ${host}`); }
  if (!addresses.length) throw Error(`Адрес ${host} не разрешается`);
  for (const address of addresses) {
    const literal = decideRequest(`http://${address.includes(':') ? `[${address}]` : address}/`, baseUrl, baseLoopback);
    if (!literal.allow) throw Error(literal.reason || 'Адрес резолвится в запрещённую сеть');
  }
}

export function isResolvedInside(root, target) {
  const base = path.resolve(root);
  const full = path.resolve(target);
  return full === base || full.startsWith(base + path.sep);
}
