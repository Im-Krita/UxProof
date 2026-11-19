// Browser-safe URL policy. No Node built-ins: the UI, the runner and the Rust
// golden fixture table must agree on which literal addresses are forbidden.

const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata.goog', 'metadata.internal']);
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1', '0:0:0:0:0:0:0:1']);

export function normalizeHost(hostname) {
  let host = String(hostname || '').trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  host = host.replace(/\.+$/, '');
  if (isIpv6(host)) {
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

function isIpv6(host) {
  if (!host || !host.includes(':')) return false;
  try { new URL(`http://[${host}]/`); return true; } catch { return false; }
}

// RFC 6052 well-known NAT64 prefix 64:ff9b::/96 embeds an IPv4 destination.
function nat64Ipv4(host) {
  if (!isIpv6(host)) return null;
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
  return ipv4(host) !== null || isIpv6(host);
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
  return isIpv6(host) && (parseInt(host.split(':')[0], 16) & 0xffc0) === 0xfe80;
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
  return isIpv6(host) && host.startsWith('ff');
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
  if (isIpv6(host)) return host.startsWith('fc') || host.startsWith('fd') || host.startsWith('::');
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

// Empty string when the address may be used as the project URL.
export function baseUrlError(baseUrl) {
  try { assertBaseUrlShape(baseUrl); return ''; } catch (error) { return String(error?.message || error); }
}

// Same-origin rule for `navigate` steps, shared by the editor, the runner and tests.
export function navigateDecision(baseUrl, value) {
  let base;
  try { base = new URL(baseUrl); } catch { return { allow: false, reason: 'Некорректный URL проекта' }; }
  const raw = String(value ?? '').trim();
  if (!raw) return { allow: true };
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:/i.test(raw)) return { allow: false, reason: 'Переход разрешён только по http(s)' };
  if (!raw.includes('://') && !raw.startsWith('//')) return { allow: true };
  let target;
  try { target = new URL(raw, base); } catch { return { allow: false, reason: 'Некорректный адрес перехода' }; }
  if (target.origin !== base.origin) return { allow: false, reason: 'Переход за пределы адреса проекта запрещён' };
  return decideRequest(target.href, base.href, false);
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
