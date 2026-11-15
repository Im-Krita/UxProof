// Exact matches are provisional; absence is never interpreted as a confirmed fix.
export function compareFindings(before, after) {
  const valid = report => report && report.status === 'completed' &&
    ['0.1', '0.2'].includes(report.normalizedSchemaVersion) &&
    ['partial', 'complete'].includes(report.normalizedCoverage?.status) && Array.isArray(report.normalizedFindings);
  if (!valid(before) || !valid(after) || before.normalizedSchemaVersion !== after.normalizedSchemaVersion ||
      typeof before.comparisonKey !== 'string' || !before.comparisonKey || before.comparisonKey !== after.comparisonKey) {
    return { comparable: false, findings: [] };
  }
  const ids = report => report.normalizedFindings.map(finding => finding?.findingId);
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
