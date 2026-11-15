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

// Exact matches are provisional; unmatched identities require further verification.
export function compareFindings(before, after) {
  if (typeof before?.comparisonKey !== 'string' || !before.comparisonKey || before.comparisonKey !== after?.comparisonKey ||
      !Array.isArray(before.normalizedFindings) || !Array.isArray(after.normalizedFindings)) {
    return { comparable: false, findings: [] };
  }
  const ids = report => report.normalizedFindings.map(f => f.findingId);
  const oldIds = ids(before), newIds = ids(after);
  if ([...oldIds, ...newIds].some(id => typeof id !== 'string' || !id) ||
      new Set(oldIds).size !== oldIds.length || new Set(newIds).size !== newIds.length) {
    return { comparable: false, findings: [] };
  }
  const oldSet = new Set(oldIds), newSet = new Set(newIds);
  return { comparable: true, findings: [
    ...oldIds.map(findingId => ({ findingId, status: newSet.has(findingId) ? 'still-present' : 'unverified' })),
    ...newIds.filter(id => !oldSet.has(id)).map(findingId => ({ findingId, status: 'unverified' }))
  ] };
}
