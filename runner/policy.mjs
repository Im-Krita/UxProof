import dns from 'node:dns/promises';
import path from 'node:path';
import { isIP } from 'node:net';

const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata.goog', 'metadata.internal']);
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1', '0:0:0:0:0:0:0:1']);

export function normalizeHost(hostname) {
  let host = String(hostname || '').trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  host = host.replace(/\.+$/, '');
  if (isIP(host) === 6) {
    host = new URL(`http://[${host}]/`).hostname.slice(1, -1);
    const mapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped) {
      const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
      host = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    }
  }
  return host;
}

function ipv4(host) {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map(part => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

// RFC 6052 well-known NAT64 prefix 64:ff9b::/96 embeds an IPv4 destination.
function nat64Ipv4(host) {
  if (isIP(host) !== 6) return null;
  const halves = host.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const zeros = halves.length === 2 ? 8 - left.length - right.length : 0;
  const words = [...left, ...Array(Math.max(0, zeros)).fill('0'), ...right].map(word => parseInt(word, 16));
  if (words.length !== 8 || words[0] !== 0x64 || words[1] !== 0xff9b || words.slice(2, 6).some(word => word !== 0)) return null;
  return `${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`;
}

export function isIpLiteral(host) {
  host = normalizeHost(host);
  return isIP(host) !== 0;
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
  return isIP(host) === 6 && (parseInt(host.split(':')[0], 16) & 0xffc0) === 0xfe80;
}

export function isMetadataHost(host) {
  host = normalizeHost(host);
  if (METADATA_HOSTS.has(host)) return true;
  const v4 = ipv4(host);
  return Boolean(v4 && v4[0] === 169 && v4[1] === 254 && v4[2] === 169 && v4[3] === 254);
}

export function isUnspecifiedHost(host) {
  host = normalizeHost(host);
  return host === '0.0.0.0' || host === '::';
}

export function isMulticastHost(host) {
  host = normalizeHost(host);
  const v4 = ipv4(host);
  if (v4) return v4[0] >= 224 && v4[0] <= 239;
  return isIP(host) === 6 && host.startsWith('ff');
}

export function isPrivateHost(host) {
  host = normalizeHost(host);
  const embedded = nat64Ipv4(host);
  if (embedded) return isPrivateHost(embedded) || isLoopbackHost(embedded) || isLinkLocalHost(embedded);
  if (host.endsWith('.local') || host.endsWith('.localhost') || host.endsWith('.internal')) return true;
  const v4 = ipv4(host);
  if (v4) {
    const [a, b, c] = v4;
    if (a === 10 || a === 0 || a >= 240) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 198 && b === 51 && c === 100) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    return false;
  }
  if (isIP(host) === 6) return host.startsWith('fc') || host.startsWith('fd') || host.startsWith('::');
  return false;
}

function blockedLiteral(host) {
  const embedded = nat64Ipv4(host);
  if (embedded && blockedLiteral(embedded)) return true;
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
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Таймаут DNS')), 5000); });
  let records;
  try { records = await Promise.race([Promise.resolve().then(() => lookup(key, { all: true, verbatim: true })), timeout]); }
  finally { clearTimeout(timer); }
  if (!Array.isArray(records)) throw Error('Некорректный DNS-ответ');
  const addresses = records.map(record => normalizeHost(record?.address));
  if (addresses.some(address => !isIpLiteral(address))) throw Error('Некорректный DNS-ответ');
  return addresses;
}

export async function prepareBasePolicy(baseUrl, lookup = dns.lookup) {
  const parsed = assertBaseUrlShape(baseUrl);
  const host = normalizeHost(parsed.hostname);
  let addresses = [host];
  if (!isIpLiteral(host)) {
    try { addresses = await resolveHost(host, lookup); }
    catch { throw Error(`Не удалось разрешить адрес ${host}`); }
    if (!addresses.length) throw Error(`Адрес ${host} не разрешается`);
    if (addresses.some(address => isMetadataHost(address) || isLinkLocalHost(address) || isUnspecifiedHost(address) || isMulticastHost(address))) {
      throw Error('Домен указывает на служебную сеть');
    }
    const local = addresses.map(address => isLoopbackHost(address) || isPrivateHost(address));
    if (local.some(Boolean) && local.some(value => !value)) throw Error('Домен имеет смешанные публичные и приватные адреса');
  }
  return { parsed, addresses, baseLoopback: addresses.length > 0 && addresses.every(isLoopbackHost) };
}

export async function assertAuditableUrl(baseUrl, lookup = dns.lookup) {
  return (await prepareBasePolicy(baseUrl, lookup)).parsed;
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

export async function assertRequestAllowed(targetUrl, baseUrl, baseLoopback, lookup = dns.lookup, approvedBaseAddresses) {
  const decision = decideRequest(targetUrl, baseUrl, baseLoopback);
  if (!decision.allow) throw Error(decision.reason || 'Запрос запрещён');
  const target = new URL(targetUrl);
  if (!['http:', 'https:'].includes(target.protocol)) return [];
  const host = normalizeHost(target.hostname);
  const baseHost = normalizeHost(new URL(baseUrl).hostname);
  if (isIpLiteral(host)) return [host];
  let addresses;
  try { addresses = await resolveHost(host, lookup); }
  catch { throw Error(`Не удалось разрешить адрес ${host}`); }
  if (!addresses.length) throw Error(`Адрес ${host} не разрешается`);
  if (host === baseHost && Array.isArray(approvedBaseAddresses)) {
    if (addresses.some(address => !approvedBaseAddresses.includes(address))) {
      throw Error('Домен проекта изменил DNS-адреса во время проверки');
    }
    return addresses;
  }
  for (const address of addresses) {
    const literal = decideRequest(`http://${address.includes(':') ? `[${address}]` : address}/`, baseUrl, baseLoopback);
    if (!literal.allow) throw Error(literal.reason || 'Адрес резолвится в запрещённую сеть');
  }
  return addresses;
}

export function isResolvedInside(root, target) {
  const base = path.resolve(root);
  const full = path.resolve(target);
  return full === base || full.startsWith(base + path.sep);
}
