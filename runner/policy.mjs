import dns from 'node:dns/promises';
import path from 'node:path';
import {
  normalizeHost, isIpLiteral, isLoopbackHost, isLinkLocalHost, isMetadataHost,
  isUnspecifiedHost, isMulticastHost, isPrivateHost, assertBaseUrlShape, decideRequest
} from '../shared/policy-core.mjs';

export {
  normalizeHost, isIpLiteral, isLoopbackHost, isLinkLocalHost, isMetadataHost,
  isUnspecifiedHost, isMulticastHost, isPrivateHost, assertBaseUrlShape, decideRequest
};

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
