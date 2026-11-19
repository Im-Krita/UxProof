// Extensible detectors: each rule is one bounded page-side measurement plus a
// counter. No element text, selectors or URLs leave the page process.
// Adding a rule = entry here + registry JSON + fixture test; the audit loop stays untouched.

const MEASURE_TIMEOUT_MS = 4000;
const MAX_ELEMENTS = 4000;

async function boundedEvaluate(page, fn, arg) {
  let timer;
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Detector timeout')), MEASURE_TIMEOUT_MS); });
    return await Promise.race([page.evaluate(fn, arg), timeout]);
  } finally { clearTimeout(timer); }
}

const int = value => Number.isInteger(value) && value >= 0 && value <= MAX_ELEMENTS;

// Each detector returns { count, detail, token } or null when the measurement is unusable.
export const DETECTORS = [
  {
    ruleId: 'layout:min-tap-target',
    source: 'layout',
    kind: 'layout',
    classification: 'rule-violation',
    status: 'confirmed',
    severity: 'medium',
    measure: async page => {
      const raw = await boundedEvaluate(page, limit => {
        const nodes = [...document.querySelectorAll('a[href],button,input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[tabindex]:not([tabindex="-1"])')];
        let interactive = 0, small = 0;
        for (const node of nodes) {
          if (interactive >= limit) break;
          const style = getComputedStyle(node), rect = node.getBoundingClientRect();
          if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) continue;
          if (rect.width <= 0 || rect.height <= 0) continue;
          if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) continue;
          interactive++;
          if (rect.width < 24 || rect.height < 24) small++;
        }
        return { interactive, small };
      }, MAX_ELEMENTS);
      if (!raw || !int(raw.interactive) || !int(raw.small) || raw.small > raw.interactive) return null;
      return {
        count: raw.small,
        detail: `Интерактивных элементов меньше 24×24 px: ${raw.small} из ${raw.interactive}.`,
        token: `tap:${raw.small}/${raw.interactive}`
      };
    }
  },
  {
    ruleId: 'layout:text-overflow',
    source: 'layout',
    kind: 'layout',
    classification: 'rule-violation',
    status: 'confirmed',
    severity: 'low',
    measure: async page => {
      const raw = await boundedEvaluate(page, limit => {
        let ellipsis = 0, clipped = 0;
        for (const node of document.querySelectorAll('*')) {
          if (ellipsis >= limit) break;
          const style = getComputedStyle(node);
          if (style.display === 'none' || style.visibility !== 'visible' || style.textOverflow !== 'ellipsis') continue;
          ellipsis++;
          if (node.scrollWidth > node.clientWidth + 1) clipped++;
        }
        return { ellipsis, clipped };
      }, MAX_ELEMENTS);
      if (!raw || !int(raw.ellipsis) || !int(raw.clipped) || raw.clipped > raw.ellipsis) return null;
      return {
        count: raw.clipped,
        detail: `Элементов с обрезанным многоточием текстом: ${raw.clipped}.`,
        token: `clip:${raw.clipped}/${raw.ellipsis}`
      };
    }
  },
  {
    ruleId: 'copy:repeated-button-name',
    source: 'copy',
    kind: 'copy',
    classification: 'hypothesis',
    status: 'recommendation',
    severity: 'low',
    measure: async page => {
      const raw = await boundedEvaluate(page, limit => {
        const groups = new Map();
        let buttons = 0;
        for (const node of document.querySelectorAll('button,[role="button"]')) {
          if (buttons >= limit) break;
          const style = getComputedStyle(node), rect = node.getBoundingClientRect();
          if (style.display === 'none' || style.visibility !== 'visible') continue;
          if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) continue;
          buttons++;
          const text = (node.getAttribute('aria-label') || node.innerText || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
          if (text.length < 3 || text.length > 120) continue;
          groups.set(text, (groups.get(text) || 0) + 1);
        }
        const repeated = [...groups.values()].filter(count => count >= 2);
        return { buttons, duplicateGroups: repeated.length, duplicateButtons: repeated.reduce((sum, count) => sum + count, 0) };
      }, MAX_ELEMENTS);
      if (!raw || !int(raw.buttons) || !int(raw.duplicateGroups) || !int(raw.duplicateButtons) || raw.duplicateButtons > raw.buttons) return null;
      return {
        count: raw.duplicateGroups,
        detail: `Повторяющихся подписей кнопок: ${raw.duplicateGroups} (кнопок: ${raw.duplicateButtons}). Проверьте, различает ли пользователь эти действия.`,
        token: `repeat:${raw.duplicateGroups}`
      };
    }
  }
];

// Runs only enabled rules. A detector failure is ignored, never failing the audit.
export async function runDetectors({ page, isEnabled, makeObservation, makeIssue, title, viewport, scopeIds }) {
  const observations = [], issues = [];
  for (const detector of DETECTORS) {
    if (!isEnabled(detector.ruleId)) continue;
    let measured;
    try { measured = await detector.measure(page); } catch { continue; }
    if (!measured || !measured.count) continue;
    const observation = makeObservation({
      ruleId: detector.ruleId, source: detector.source, classification: detector.classification,
      status: detector.status, token: measured.token
    });
    if (observation) observations.push(observation);
    issues.push(makeIssue({
      kind: detector.kind, status: detector.status, severity: detector.severity,
      ruleId: detector.ruleId, title: measured.detail, description: measured.detail,
      scenario: title, viewport, screenshot: null, ...scopeIds
    }));
  }
  return { observations, issues };
}
