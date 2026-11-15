// Exact matches are provisional; absence is never interpreted as a confirmed fix.
export function compareFindings(before, after, options = {}) {
  const valid = report => report && report.status === 'completed' &&
    ['0.1', '0.2'].includes(report.normalizedSchemaVersion) &&
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
    findings.push(...newIds.filter(id => !matched.has(id)).map(findingId => ({ findingId, status: 'unverified' })));
    return { comparable: true, mappedPaths: true, findings };
  }
  const oldSet = new Set(oldIds), newSet = new Set(newIds);
  return { comparable: true, findings: [
    ...oldIds.map(findingId => ({ findingId, status: newSet.has(findingId) ? 'still-present' : 'unverified' })),
    ...newIds.filter(id => !oldSet.has(id)).map(findingId => ({ findingId, status: 'unverified' }))
  ] };
}

// A passed step is evidence about that execution, not proof that a defect is fixed.
export function recheckedSteps(before, after, finding, options = {}) {
  if (!compareFindings(before, after, options).comparable || before.scenarioEventsVersion !== '0.1' ||
      after.scenarioEventsVersion !== '0.1' || !Array.isArray(before.scenarioEvents) ||
      !Array.isArray(after.scenarioEvents) || !Array.isArray(after.results) ||
      !finding || !before.normalizedFindings.includes(finding) ||
      !finding.ruleId?.startsWith('playwright:step:') || !Array.isArray(finding.observations) || !finding.observations.length) return null;
  const type = finding.ruleId.slice('playwright:step:'.length);
  const unique = new Set();
  let passed = 0;
  for (const observation of finding.observations) {
    const { scenarioId, viewportId, stepId } = observation || {};
    if (observation?.runId !== before.runId || observation.source !== 'playwright' ||
        typeof scenarioId !== 'string' || !scenarioId || typeof viewportId !== 'string' || !viewportId ||
        typeof stepId !== 'string' || !/^[1-9]\d*$/.test(stepId)) return null;
    const key = JSON.stringify([scenarioId, viewportId, stepId]);
    if (unique.has(key)) return null;
    unique.add(key);
    const relevant = (report, phase) => report.scenarioEvents.filter(event => event?.runId === report.runId &&
      event.scenarioId === scenarioId && event.viewportId === viewportId && event.stepId === stepId &&
      event.stepType === type && event.phase === phase);
    if (relevant(before, 'error').length !== 1) return null;
    const events = after.scenarioEvents.filter(event => event?.runId === after.runId && event.scenarioId === scenarioId &&
      event.viewportId === viewportId && event.stepId === stepId && event.stepType === type);
    const phases = events.map(event => event.phase).join('/');
    if (phases !== 'before/action/after' || events.some(event => !event.combinationId || event.combinationId !== events[0].combinationId)) continue;
    const results = after.results.filter(result => result?.id === events[0].combinationId);
    const steps = results.length === 1 && Array.isArray(results[0].steps) ? results[0].steps.filter(step => String(step.index) === stepId) : [];
    if (steps.length === 1 && steps[0].type === type && steps[0].status === 'passed') passed++;
  }
  return { passed, total: unique.size };
}

// Validate only the fields needed to render the extension; unknown rule IDs remain visible.
export function presentableFindings(report) {
  if (!report || typeof report.runId !== 'string' || !report.runId ||
      !['0.1', '0.2'].includes(report.normalizedSchemaVersion) || !Array.isArray(report.normalizedFindings)) return null;
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
