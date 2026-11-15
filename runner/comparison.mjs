import { createHash } from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function comparisonKey(config) {
  const input = { version: 1, baseUrl: config.baseUrl, scenarios: config.scenarios, viewports: config.viewports, options: config.options || {} };
  return `comparison-v1-${createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex')}`;
}

export { compareFindings } from './matching.mjs';
