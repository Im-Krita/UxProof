import { randomUUID } from 'node:crypto';
import { validateDomSummary } from './dom-summary.mjs';
import { validateElementGeometry } from './element-geometry.mjs';
import { pageScope } from './matching.mjs';
import { scopeIdentifier } from './findings.mjs';

const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const fail = () => { throw new TypeError('Invalid scenario event sequence'); };

export function stepEvent(base, phase, extra = {}) {
  return { eventId: randomUUID(), ...base, phase, at: new Date().toISOString(), ...extra };
}

// Versionless historic reports remain readable; v0.1 events are checked against results.
export function validateScenarioEvents(report) {
  if (!report || typeof report !== 'object') fail();
  if (report.scenarioEventsVersion === undefined) return true;
  if (report.scenarioEventsVersion !== '0.1' || !nonempty(report.runId) || !Array.isArray(report.results) || !Array.isArray(report.scenarioEvents)) fail();
  if (report.baseScopeId !== undefined && (!/^scope-[a-f0-9]{64}$/.test(report.baseScopeId) || scopeIdentifier(report.baseUrl) !== report.baseScopeId)) fail();
  const expected = new Map(), groups = new Map(), eventIds = new Set(), resultIds = new Set();
  for (const result of report.results) {
    if (!nonempty(result?.id) || resultIds.has(result.id) || !Array.isArray(result.steps)) fail();
    resultIds.add(result.id);
    for (const step of result.steps) {
      if (!Number.isInteger(step?.index) || step.index < 1 || !nonempty(step.type) || !['passed', 'failed'].includes(step.status)) fail();
      const key = JSON.stringify([result.id, String(step.index)]);
      if (expected.has(key)) fail();
      expected.set(key, step);
    }
  }
  for (const event of report.scenarioEvents) {
    if (!event || !nonempty(event.eventId) || eventIds.has(event.eventId) || event.runId !== report.runId ||
        !nonempty(event.combinationId) || !nonempty(event.scenarioId) || !nonempty(event.viewportId) ||
        typeof event.stepId !== 'string' || !/^[1-9]\d*$/.test(event.stepId) || !nonempty(event.stepType) ||
        !['before', 'action', 'after', 'error'].includes(event.phase) || typeof event.at !== 'string' || !Number.isFinite(Date.parse(event.at))) fail();
    const key = JSON.stringify([event.combinationId, event.stepId]);
    const step = expected.get(key);
    if (!step || step.type !== event.stepType) fail();
    if (event.pageScope !== undefined && (!['after', 'error'].includes(event.phase) || pageScope(event.pageScope) !== event.pageScope)) fail();
    if (event.pageScopeId !== undefined && (!['after', 'error'].includes(event.phase) || !/^scope-[a-f0-9]{64}$/.test(event.pageScopeId))) fail();
    if (event.phase === 'error') {
      if (event.screenshot !== (step.screenshot ?? null) ||
          (event.screenshot !== null && !/^[a-zA-Z0-9_-]{1,160}\.png$/.test(event.screenshot))) fail();
      if (event.domSummary !== undefined && event.domSummary !== null) validateDomSummary(event.domSummary);
      if (event.elementGeometry !== undefined && event.elementGeometry !== null &&
          (!event.screenshot || !validateElementGeometry(event.elementGeometry))) fail();
    } else if (event.screenshot !== undefined || event.domSummary !== undefined || event.elementGeometry !== undefined) fail();
    eventIds.add(event.eventId);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  if (groups.size !== expected.size) fail();
  for (const [key, step] of expected) {
    const events = groups.get(key);
    if (!events || events.some(event => event.scenarioId !== events[0].scenarioId || event.viewportId !== events[0].viewportId)) fail();
    const sequence = events.map(event => event.phase).join('/');
    if (step.status === 'passed' && sequence !== 'before/action/after') fail();
    if (step.status === 'failed' && sequence !== 'before/action/error' && sequence !== 'before/error') fail();
  }
  return true;
}
