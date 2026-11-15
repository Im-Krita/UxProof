const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stringFields = (value, fields) => object(value) && fields.every(key => typeof value[key] === 'string');
const numberFields = (value, fields) => object(value) && fields.every(key => typeof value[key] === 'number' && Number.isFinite(value[key]));
const optionalString = value => value === undefined || value === null || typeof value === 'string';

// Accept legacy and future extensions while rejecting records the existing UI cannot render.
export function isHistoryReport(report) {
  if (!stringFields(report, ['runId', 'project', 'baseUrl', 'startedAt', 'status']) || !report.runId ||
      !numberFields(report, ['durationMs']) ||
      !numberFields(report.summary, ['totalRuns', 'passedRuns', 'failedRuns', 'confirmedIssues', 'aiSuggestions', 'accessibilityIssues']) ||
      !Array.isArray(report.results) || !Array.isArray(report.issues) || !Array.isArray(report.warnings)) return false;
  return report.results.every(result =>
    stringFields(result, ['id', 'scenario', 'viewport', 'status']) && numberFields(result, ['passedSteps', 'totalSteps']) &&
    Array.isArray(result.steps) && result.steps.every(step => stringFields(step, ['name', 'status']) && numberFields(step, ['durationMs']) && optionalString(step.error))) &&
    report.issues.every(issue => stringFields(issue, ['id', 'kind', 'status', 'severity', 'title', 'description', 'scenario', 'viewport']) &&
      optionalString(issue.screenshot) && optionalString(issue.reproduction) && optionalString(issue.helpUrl)) &&
    report.warnings.every(warning => typeof warning === 'string');
}
