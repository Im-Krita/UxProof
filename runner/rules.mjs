import { readFileSync } from 'node:fs';

const nonempty = value => typeof value === 'string' && Boolean(value.trim());
const stringList = (value, min = 0) => Array.isArray(value) && value.length >= min && value.every(nonempty) && new Set(value).size === value.length;
const keysAre = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const ruleFields = ['ruleId', 'version', 'title', 'category', 'scope', 'requiredEvidence', 'trigger', 'exclusions', 'classification', 'remediation', 'fixtures', 'status'];

export function validateRegistry(registry) {
  if (!keysAre(registry, ['schemaVersion', 'rules']) || registry.schemaVersion !== '0.1' || !Array.isArray(registry.rules) || !registry.rules.length) throw TypeError('Invalid rule registry');
  const ids = new Set();
  for (const rule of registry.rules) {
    if (!keysAre(rule, ruleFields) || !/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/.test(rule.ruleId || '') || ids.has(rule.ruleId) ||
        !/^\d+\.\d+\.\d+$/.test(rule.version || '') || ![rule.title, rule.category, rule.scope, rule.remediation].every(nonempty) ||
        !stringList(rule.requiredEvidence, 1) || !stringList(rule.exclusions) || !stringList(rule.fixtures, 1) ||
        !keysAre(rule.trigger, ['type', 'toleranceCssPx']) || rule.trigger.type !== 'viewport-overflow' ||
        typeof rule.trigger.toleranceCssPx !== 'number' || !Number.isFinite(rule.trigger.toleranceCssPx) || rule.trigger.toleranceCssPx < 0 || rule.trigger.toleranceCssPx > 20 ||
        rule.classification !== 'technical-fact' || !['enabled', 'disabled'].includes(rule.status)) throw TypeError('Invalid rule');
    ids.add(rule.ruleId);
  }
  return true;
}

const registry = JSON.parse(readFileSync(new URL('./rules/registry-v0.1.json', import.meta.url), 'utf8'));
validateRegistry(registry);
export const ruleIds = Object.freeze(registry.rules.map(rule => rule.ruleId));

export function validateDisabledRules(value) {
  if (value === undefined) return true;
  if (!stringList(value) || value.length > ruleIds.length || value.some(id => !ruleIds.includes(id))) throw TypeError('Invalid disabled rules');
  return true;
}

export function viewportOverflow(measurement, disabledRules = []) {
  validateDisabledRules(disabledRules);
  const rule = registry.rules.find(item => item.ruleId === 'layout:viewport-overflow');
  if (!rule || rule.status !== 'enabled' || disabledRules.includes(rule.ruleId)) return null;
  const { actual, expected } = measurement || {};
  if (![actual, expected].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1e7)) return null;
  if (actual <= expected + rule.trigger.toleranceCssPx) return null;
  return { ruleId: rule.ruleId, title: rule.title, description: `Контент ${actual}px шире окна ${expected}px`, actual, expected };
}
