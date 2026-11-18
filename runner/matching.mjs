export function pageScope(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? `${url.origin}${url.pathname}` : null;
  } catch { return null; }
}

// Exact matches are provisional; absence alone is never interpreted as a confirmed fix.
export function compareFindings(before, after, options = {}) {
  const valid = report => report && report.status === 'completed' &&
    ['0.1', '0.2', '0.3'].includes(report.normalizedSchemaVersion) &&
    ['partial', 'complete'].includes(report.normalizedCoverage?.status) && Array.isArray(report.normalizedFindings);
  if (!valid(before) || !valid(after) || before.normalizedSchemaVersion !== after.normalizedSchemaVersion ||
      typeof before.comparisonKey !== 'string' || !before.comparisonKey || typeof after.comparisonKey !== 'string' || !after.comparisonKey) {
    return { comparable: false, findings: [] };
  }
  const exact = before.comparisonKey === after.comparisonKey;
  let oldScope, newScope;
  if (!exact) {
    try {
      const a = new URL(before.baseUrl), b = new URL(after.baseUrl);
      if (options.mapPaths !== true || !before.comparisonProfileKey || before.comparisonProfileKey !== after.comparisonProfileKey ||
          !['http:', 'https:'].includes(a.protocol) || a.origin !== b.origin || a.search !== b.search || a.hash !== b.hash ||
          a.username || a.password || b.username || b.password || a.pathname === b.pathname) throw Error('incompatible');
      oldScope = `${a.origin}${a.pathname}`; newScope = `${b.origin}${b.pathname}`;
    } catch { return { comparable: false, findings: [] }; }
  }
  const ids = report => report.normalizedFindings.map(finding => finding?.findingId);
  const oldIds = ids(before), newIds = ids(after);
  if ([...oldIds, ...newIds].some(id => typeof id !== 'string' || !id) ||
      new Set(oldIds).size !== oldIds.length || new Set(newIds).size !== newIds.length) {
    return { comparable: false, findings: [] };
  }
  if (!exact) {
    const anchorKey = (finding, scope) => {
      if (typeof finding?.ruleId !== 'string' || !finding.ruleId || !Array.isArray(finding.anchor) ||
          finding.anchor.length < 2 || finding.anchor[0] !== scope ||
          finding.anchor.some(part => typeof part !== 'string' || !part)) return null;
      return JSON.stringify([finding.ruleId, finding.anchor.slice(1)]);
    };
    const index = (findings, scope) => {
      const map = new Map();
      for (const finding of findings) {
        const key = anchorKey(finding, scope);
        if (key) map.set(key, map.has(key) ? null : finding.findingId);
      }
      return map;
    };
    const oldIndex = index(before.normalizedFindings, oldScope), newIndex = index(after.normalizedFindings, newScope);
    const matched = new Set();
    const findings = before.normalizedFindings.map(finding => {
      const key = anchorKey(finding, oldScope);
      const afterFindingId = key && oldIndex.get(key) === finding.findingId ? newIndex.get(key) : null;
      if (!afterFindingId) return { findingId: finding.findingId, status: 'unverified' };
      matched.add(afterFindingId);
      return { findingId: finding.findingId, afterFindingId, status: 'still-present' };
    });
    findings.push(...newIds.filter(id => !matched.has(id)).map(findingId => ({ findingId, status: 'new' })));
    return markRecheckedSteps(before, after, { comparable: true, mappedPaths: true, findings });
  }
  const oldSet = new Set(oldIds), newSet = new Set(newIds);
  return markRecheckedSteps(before, after, { comparable: true, findings: [
    ...oldIds.map(findingId => ({ findingId, status: newSet.has(findingId) ? 'still-present' : 'unverified' })),
    ...newIds.filter(id => !oldSet.has(id)).map(findingId => ({ findingId, status: 'new' }))
  ] });
}

function stepEvidence(before, after, finding, mappedPaths) {
  if (before.scenarioEventsVersion !== '0.1' ||
      after.scenarioEventsVersion !== '0.1' || !Array.isArray(before.scenarioEvents) ||
      !Array.isArray(after.scenarioEvents) || !Array.isArray(before.results) || !Array.isArray(after.results) ||
      !finding || !before.normalizedFindings.includes(finding) ||
      typeof finding.ruleId !== 'string' || !finding.ruleId.startsWith('playwright:step:') ||
      !Array.isArray(finding.anchor) || finding.anchor.length !== 4 || !pageScope(finding.anchor[0]) ||
      finding.anchor[0] !== pageScope(finding.anchor[0]) || !/^definition:[a-f0-9]{64}$/.test(finding.anchor[2]) ||
      !Array.isArray(finding.observations) || !finding.observations.length) return null;
  for (const report of [before, after]) {
    const ids = report.scenarioEvents.map(event => event?.eventId);
    if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) return null;
  }
  const type = finding.ruleId.slice('playwright:step:'.length);
  const unique = new Set();
  let passed = 0, samePagePassed = 0;
  const targetScope = mappedPaths && finding.anchor[0] === pageScope(before.baseUrl) ? pageScope(after.baseUrl) : mappedPaths ? null : finding.anchor[0];
  const inspect = (report, observation, status) => {
    const events = report.scenarioEvents.filter(event => event?.scenarioId === observation.scenarioId &&
      event.viewportId === observation.viewportId && event.stepId === observation.stepId);
    const sequence = events.map(event => event.phase).join('/');
    if (status === 'passed' ? sequence !== 'before/action/after' : !['before/action/error', 'before/error'].includes(sequence)) return null;
    if (!events.length || events.some(event => event.runId !== report.runId || event.stepType !== type ||
        typeof event.eventId !== 'string' || !event.eventId || typeof event.at !== 'string' || !Number.isFinite(Date.parse(event.at)) ||
        typeof event.combinationId !== 'string' || !event.combinationId || event.combinationId !== events[0].combinationId) ||
        new Set(events.map(event => event.eventId)).size !== events.length) return null;
    const results = report.results.filter(result => result?.id === events[0].combinationId);
    const steps = results.length === 1 && Array.isArray(results[0].steps) ? results[0].steps.filter(step => String(step.index) === observation.stepId) : [];
    if (steps.length !== 1 || steps[0].type !== type || steps[0].status !== status) return null;
    if (status === 'failed' && events.at(-1).screenshot !== (steps[0].screenshot ?? null)) return null;
    return events.at(-1);
  };
  for (const observation of finding.observations) {
    const { scenarioId, viewportId, stepId } = observation || {};
    if (observation?.runId !== before.runId || observation.source !== 'playwright' ||
        observation.ruleId !== finding.ruleId || observation.classification !== 'technical-fact' || observation.status !== 'confirmed' ||
        JSON.stringify(observation.anchor) !== JSON.stringify(finding.anchor) ||
        typeof scenarioId !== 'string' || !scenarioId || typeof viewportId !== 'string' || !viewportId ||
        typeof stepId !== 'string' || !/^[1-9]\d*$/.test(stepId) || finding.anchor[1] !== `scenario:${scenarioId}` ||
        finding.anchor[3] !== `step:${stepId}`) return null;
    const key = JSON.stringify([scenarioId, viewportId, stepId]);
    if (unique.has(key)) return null;
    unique.add(key);
    const oldEvent = inspect(before, observation, 'failed');
    if (!oldEvent) return null;
    const newEvent = inspect(after, observation, 'passed');
    if (!newEvent) continue;
    passed++;
    const validId = id => typeof id === 'string' && /^scope-[a-f0-9]{64}$/.test(id);
    if (targetScope && validId(oldEvent.pageScopeId) && validId(newEvent.pageScopeId) &&
        (mappedPaths ? validId(before.baseScopeId) && validId(after.baseScopeId) && oldEvent.pageScopeId === before.baseScopeId && newEvent.pageScopeId === after.baseScopeId
          : oldEvent.pageScopeId === newEvent.pageScopeId)) samePagePassed++;
  }
  return { passed, total: unique.size, samePagePassed, targetScope };
}

function markRecheckedSteps(before, after, comparison) {
  for (const item of comparison.findings) {
    if (item.status !== 'unverified') continue;
    const finding = before.normalizedFindings.find(entry => entry.findingId === item.findingId);
    const evidence = stepEvidence(before, after, finding, Boolean(comparison.mappedPaths));
    if (!evidence || !evidence.total || evidence.samePagePassed !== evidence.total) continue;
    const targetAnchor = [evidence.targetScope, ...finding.anchor.slice(1)];
    const scenarioId = finding.observations[0].scenarioId, stepId = finding.observations[0].stepId;
    if (after.scenarioEvents.some(event => event?.phase === 'error' && event.scenarioId === scenarioId &&
        event.stepId === stepId && event.stepType === finding.ruleId.slice('playwright:step:'.length))) continue;
    if (after.normalizedFindings.some(entry => entry.findingId === finding.findingId ||
        (entry.ruleId === finding.ruleId && JSON.stringify(entry.anchor) === JSON.stringify(targetAnchor)))) continue;
    item.status = 'resolved';
  }
  return comparison;
}

// A passed execution is counted even for historical reports without page-scope evidence.
export function recheckedSteps(before, after, finding, options = {}) {
  const comparison = compareFindings(before, after, options);
  if (!comparison.comparable) return null;
  const evidence = stepEvidence(before, after, finding, Boolean(comparison.mappedPaths));
  return evidence ? { passed: evidence.passed, total: evidence.total } : null;
}

// Validate only the fields needed to render the extension; unknown rule IDs remain visible.
export function presentableFindings(report) {
  if (!report || typeof report.runId !== 'string' || !report.runId ||
      !['0.1', '0.2', '0.3'].includes(report.normalizedSchemaVersion) || !Array.isArray(report.normalizedFindings)) return null;
  const findingIds = new Set(), observationIds = new Set();
  for (const finding of report.normalizedFindings) {
    if (!finding || typeof finding.findingId !== 'string' || !finding.findingId || findingIds.has(finding.findingId) ||
        typeof finding.ruleId !== 'string' || !finding.ruleId || !Array.isArray(finding.observations) || !finding.observations.length) return null;
    findingIds.add(finding.findingId);
    for (const observation of finding.observations) {
      if (!observation || typeof observation.observationId !== 'string' || !observation.observationId || observationIds.has(observation.observationId) ||
          observation.runId !== report.runId || typeof observation.scenarioId !== 'string' || !observation.scenarioId ||
          typeof observation.viewportId !== 'string' || !observation.viewportId || typeof observation.source !== 'string' || !observation.source) return null;
      if (observation.evidence !== undefined && (!observation.evidence || typeof observation.evidence !== 'object' ||
          !/^[a-zA-Z0-9_-]{1,160}\.png$/.test(observation.evidence.screenshot))) return null;
      observationIds.add(observation.observationId);
    }
  }
  return report.normalizedFindings;
}

const SOURCE_KIND = {
  axe: 'accessibility',
  playwright: 'functional',
  runtime: 'javascript',
  layout: 'overflow',
  copy: 'copy',
  ai: 'ai-ux'
};

const VIEWPORT_DISPLAY = { mobile: 'Телефон', tablet: 'Планшет', desktop: 'Компьютер' };
const VIEWPORT_ALIASES = {
  mobile: ['mobile', 'телефон'],
  tablet: ['tablet', 'планшет'],
  desktop: ['desktop', 'компьютер']
};

export function displayViewportLabel(viewportId, stored) {
  if (viewportId && VIEWPORT_DISPLAY[viewportId]) return VIEWPORT_DISPLAY[viewportId];
  const lower = String(stored || '').toLowerCase();
  for (const [id, aliases] of Object.entries(VIEWPORT_ALIASES)) {
    if (aliases.includes(lower)) return VIEWPORT_DISPLAY[id];
  }
  return (typeof stored === 'string' && stored.trim() ? stored : viewportId) || '';
}

function combinationResult(report, observation) {
  if (!report || !Array.isArray(report.results) || !observation) return undefined;
  const shot = observation.evidence?.screenshot;
  const named = typeof shot === 'string' && shot.match(/^run-(\d+)-(\d+)\.png$/);
  if (named) {
    const hit = report.results.find(item => item.id === `${Number(named[1]) - 1}-${Number(named[2]) - 1}`);
    if (hit) return hit;
  }
  const s = typeof observation.scenarioId === 'string' && observation.scenarioId.startsWith('index:')
    ? Number(observation.scenarioId.slice(6)) : NaN;
  const v = typeof observation.viewportId === 'string' && observation.viewportId.startsWith('index:')
    ? Number(observation.viewportId.slice(6)) : NaN;
  if (Number.isInteger(s) && Number.isInteger(v)) {
    return report.results.find(item => item.id === `${s}-${v}`);
  }
  return undefined;
}

function sameViewport(issue, observation) {
  if (issue.viewportId && observation.viewportId) return issue.viewportId === observation.viewportId;
  const aliases = VIEWPORT_ALIASES[observation.viewportId] || [];
  const lower = String(issue.viewport || '').toLowerCase();
  if (aliases.includes(lower) || lower === String(observation.viewportId || '').toLowerCase()) return true;
  return displayViewportLabel(observation.viewportId, issue.viewport) === issue.viewport;
}

function issueMatchesObservation(report, issue, finding, observation) {
  if (!issue || !finding || !observation) return false;
  const kind = SOURCE_KIND[observation.source];
  if (!kind || issue.kind !== kind) return false;
  if (observation.source === 'axe') {
    if (`axe:${issue.ruleId}` !== finding.ruleId && issue.ruleId !== finding.ruleId) return false;
  } else if (observation.source === 'playwright') {
    if (String(issue.step) !== String(observation.stepId)) return false;
  } else if (finding.ruleId && issue.ruleId && issue.ruleId !== finding.ruleId) {
    return false;
  }
  const shot = observation.evidence?.screenshot;
  if (shot && issue.screenshot && issue.screenshot !== shot) return false;
  if (issue.scenarioId && observation.scenarioId && issue.scenarioId !== observation.scenarioId) return false;
  if (issue.viewportId && observation.viewportId && issue.viewportId !== observation.viewportId) return false;
  if (!issue.scenarioId || !issue.viewportId) {
    const result = combinationResult(report, observation);
    if (result) {
      if (issue.scenario !== result.scenario) return false;
      if (issue.viewport !== result.viewport && !sameViewport(issue, observation)) return false;
    } else if (observation.viewportId && !sameViewport(issue, observation)) {
      return false;
    }
  }
  return true;
}

export function findingIssue(report, finding, observationId) {
  if (!report || !finding || !Array.isArray(report.issues) || !Array.isArray(finding.observations)) return undefined;
  const observations = observationId
    ? finding.observations.filter(item => item.observationId === observationId)
    : finding.observations;
  for (const observation of observations) {
    const issue = report.issues.find(item => issueMatchesObservation(report, item, finding, observation));
    if (issue) return issue;
  }
  return undefined;
}
