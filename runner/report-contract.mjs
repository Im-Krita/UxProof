import { findingId } from './findings.mjs';

const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const fail = () => { throw new TypeError('Invalid normalized report'); };

const CONFIRMED_LAYOUT_RULES = new Set(['layout:viewport-overflow', 'layout:text-overflow', 'layout:min-tap-target']);
const RECOMMENDATION_COPY_RULES = new Set(['copy:duplicate-heading', 'copy:repeated-button-name']);

const v03 = observation => {
  const runtime = observation.source === 'runtime' && observation.classification === 'technical-fact' && observation.ruleId === 'javascript:pageerror' && observation.status === 'confirmed';
  const layout = observation.source === 'layout' && observation.classification === 'rule-violation' && CONFIRMED_LAYOUT_RULES.has(observation.ruleId) && observation.status === 'confirmed';
  const copy = observation.source === 'copy' && observation.classification === 'hypothesis' && RECOMMENDATION_COPY_RULES.has(observation.ruleId) && observation.status === 'recommendation';
  const ai = observation.source === 'ai' && observation.classification === 'hypothesis' && observation.ruleId.startsWith('ai-ux:') && observation.status === 'recommendation';
  return runtime || layout || copy || ai;
};

// Versionless v0.1 reports are preserved as-is; only the versioned extension is validated here.
export function validateNormalizedReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) fail();
  if (report.normalizedSchemaVersion === undefined) return true;
  if (!['0.1', '0.2', '0.3'].includes(report.normalizedSchemaVersion) || !nonempty(report.runId) ||
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
          observation.ruleId !== finding.ruleId || findingId(observation) !== finding.findingId) fail();
      const axe = observation.source === 'axe' && observation.classification === 'rule-violation' && observation.ruleId.startsWith('axe:') && observation.status === 'confirmed';
      const step = ['0.2', '0.3'].includes(report.normalizedSchemaVersion) && observation.source === 'playwright' &&
        observation.classification === 'technical-fact' && observation.ruleId.startsWith('playwright:step:') &&
        typeof observation.stepId === 'string' && /^[1-9]\d*$/.test(observation.stepId) && observation.status === 'confirmed';
      const extra = report.normalizedSchemaVersion === '0.3' && v03(observation);
      if ((!axe && !step && !extra) || !report.normalizedCoverage.sources.includes(observation.source)) fail();
      if (observation.evidence !== undefined && (!observation.evidence || typeof observation.evidence !== 'object' ||
          !/^[a-zA-Z0-9_-]{1,160}\.png$/.test(observation.evidence.screenshot))) fail();
      seenObservations.add(observation.observationId);
    }
  }
  return true;
}
