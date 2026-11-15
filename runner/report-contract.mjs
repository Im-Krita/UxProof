import { findingId } from './findings.mjs';

const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const fail = () => { throw new TypeError('Invalid normalized report'); };

// Versionless v0.1 reports are preserved as-is; only the versioned extension is validated here.
export function validateNormalizedReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) fail();
  if (report.normalizedSchemaVersion === undefined) return true;
  if (report.normalizedSchemaVersion !== '0.1' || !nonempty(report.runId) ||
      report.normalizedCoverage?.status !== 'partial' ||
      !Array.isArray(report.normalizedCoverage.sources) || !report.normalizedCoverage.sources.every(nonempty) ||
      !Array.isArray(report.normalizedFindings)) fail();
  const seenFindings = new Set(), seenObservations = new Set();
  for (const finding of report.normalizedFindings) {
    if (!finding || finding.findingId !== findingId(finding) || seenFindings.has(finding.findingId) ||
        !Array.isArray(finding.observations) || !finding.observations.length) fail();
    seenFindings.add(finding.findingId);
    for (const observation of finding.observations) {
      if (!observation || !nonempty(observation.observationId) || seenObservations.has(observation.observationId) ||
          observation.runId !== report.runId || !nonempty(observation.scenarioId) || !nonempty(observation.viewportId) ||
          observation.ruleId !== finding.ruleId || findingId(observation) !== finding.findingId ||
          observation.source !== 'axe' || observation.classification !== 'rule-violation' || observation.status !== 'confirmed') fail();
      if (observation.evidence !== undefined && (!observation.evidence || typeof observation.evidence !== 'object' ||
          !/^[a-zA-Z0-9_-]{1,160}\.png$/.test(observation.evidence.screenshot))) fail();
      seenObservations.add(observation.observationId);
    }
  }
  return true;
}
