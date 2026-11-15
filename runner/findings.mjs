import { createHash, randomUUID } from 'node:crypto';
import { pageScope } from './matching.mjs';

export function scopeIdentifier(value) {
  const scope = pageScope(value);
  return scope ? `scope-${createHash('sha256').update(scope).digest('hex')}` : null;
}

// Identity is based only on explicit rule and anchor evidence, never on run metadata.
export function findingId({ ruleId, anchor }) {
  if (typeof ruleId !== 'string' || !ruleId.trim() || !Array.isArray(anchor) ||
      !anchor.length || anchor.some(part => typeof part !== 'string' || !part.trim())) {
    throw new TypeError('A rule ID and a non-empty anchor are required');
  }
  const identity = JSON.stringify([ruleId, anchor]);
  return `finding-${createHash('sha256').update(identity).digest('hex')}`;
}

export function groupObservations(observations) {
  const groups = new Map();
  const ids = new Set();
  for (const observation of observations) {
    if (typeof observation.observationId !== 'string' || !observation.observationId || ids.has(observation.observationId)) {
      throw new TypeError('Each observationId must be non-empty and unique');
    }
    ids.add(observation.observationId);
    const id = findingId(observation);
    if (!groups.has(id)) groups.set(id, { findingId: id, ruleId: observation.ruleId, anchor: observation.anchor, observations: [] });
    groups.get(id).observations.push(observation);
  }
  return [...groups.values()];
}

// Axe selectors identify nodes only within a page; do not guess when evidence is absent.
export function axeObservations({ violation, pageUrl, scenarioId, viewportId, runId }) {
  let url;
  try { url = new URL(pageUrl); } catch { return []; }
  if (!['http:', 'https:'].includes(url.protocol) || !violation?.id || !Array.isArray(violation.nodes)) return [];
  const scope = `${url.origin}${url.pathname}`;
  return violation.nodes.flatMap(node => {
    if (!Array.isArray(node.target) || !node.target.length || node.target.some(part => typeof part !== 'string' || !part.trim())) return [];
    return [{ observationId: randomUUID(), runId, scenarioId, viewportId,
      ruleId: `axe:${violation.id}`, anchor: [scope, ...node.target], source: 'axe',
      classification: 'rule-violation', status: 'confirmed' }];
  });
}

export function failedStepObservation({ pageUrl, scenario, step, stepIndex, scenarioId, viewportId, runId }) {
  let url;
  try { url = new URL(pageUrl); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || !Array.isArray(scenario?.steps) ||
      !Number.isInteger(stepIndex) || stepIndex < 0 || !step?.type) return null;
  const definition = scenario.steps.map(item => [String(item.type || ''), String(item.target || ''), String(item.value ?? '')]);
  const scenarioFingerprint = createHash('sha256').update(JSON.stringify(definition)).digest('hex');
  return { observationId: randomUUID(), runId, scenarioId, viewportId, stepId: String(stepIndex + 1),
    ruleId: `playwright:step:${step.type}`,
    anchor: [`${url.origin}${url.pathname}`, `scenario:${scenarioId}`, `definition:${scenarioFingerprint}`, `step:${stepIndex + 1}`],
    source: 'playwright', classification: 'technical-fact', status: 'confirmed' };
}
