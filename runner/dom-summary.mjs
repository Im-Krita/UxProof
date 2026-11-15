const countFields = ['elements', 'interactive', 'headings', 'dialogs', 'forms'];
const coverageFields = ['elementsSeen', 'iframes', 'canvases', 'openShadowRoots'];

export function validateDomSummary(summary) {
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const count = value => Number.isInteger(value) && value >= 0 && value <= 5000;
  const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  const viewportFields = ['width', 'height', 'deviceScaleFactor', 'scrollX', 'scrollY'];
  if (!summary || typeof summary !== 'object' || typeof summary.capturedAt !== 'string' || !Number.isFinite(Date.parse(summary.capturedAt)) ||
      !exact(summary, ['capturedAt', 'viewport', 'visible', 'coverage']) || !exact(summary.viewport, viewportFields) ||
      !viewportFields.every(key => finite(summary.viewport[key])) ||
      summary.viewport.width <= 0 || summary.viewport.height <= 0 || summary.viewport.deviceScaleFactor <= 0 ||
      !exact(summary.visible, countFields) || !countFields.every(key => count(summary.visible[key])) ||
      !exact(summary.coverage, ['status', 'truncated', ...coverageFields]) || summary.coverage.status !== 'partial' || typeof summary.coverage.truncated !== 'boolean' ||
      !coverageFields.every(key => count(summary.coverage[key])) || summary.visible.elements > summary.coverage.elementsSeen ||
      countFields.slice(1).some(key => summary.visible[key] > summary.visible.elements) ||
      coverageFields.slice(1).some(key => summary.coverage[key] > summary.coverage.elementsSeen)) throw new TypeError('Invalid DOM summary');
  return true;
}

// This deliberately stores counts and geometry only, never markup, text, attributes or field values.
export async function collectDomSummary(page, { maxElements = 5000, timeoutMs = 2500 } = {}) {
  if (!Number.isInteger(maxElements) || maxElements < 1 || maxElements > 5000 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) {
    throw new TypeError('Invalid DOM summary limits');
  }
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('DOM summary timeout')), timeoutMs); });
  let raw;
  try {
    raw = await Promise.race([page.evaluate(limit => {
      const result = { viewport: { width: window.innerWidth, height: window.innerHeight, deviceScaleFactor: window.devicePixelRatio,
        scrollX: window.scrollX, scrollY: window.scrollY },
      visible: { elements: 0, interactive: 0, headings: 0, dialogs: 0, forms: 0 },
      coverage: { status: 'partial', truncated: false, elementsSeen: 0, iframes: 0, canvases: 0, openShadowRoots: 0 } };
      const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
      let node;
      while ((node = walker.nextNode())) {
        if (result.coverage.elementsSeen >= limit) { result.coverage.truncated = true; break; }
        result.coverage.elementsSeen++;
        const tag = node.tagName.toLowerCase();
        if (tag === 'iframe') result.coverage.iframes++;
        if (tag === 'canvas') result.coverage.canvases++;
        if (node.shadowRoot) result.coverage.openShadowRoots++;
        const style = getComputedStyle(node), rect = node.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 ||
            rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 ||
            rect.left >= window.innerWidth || rect.top >= window.innerHeight) continue;
        result.visible.elements++;
        if (node.matches('a[href],button,input,select,textarea,[role="button"],[tabindex]')) result.visible.interactive++;
        if (/^h[1-6]$/.test(tag)) result.visible.headings++;
        if (node.matches('dialog,[role="dialog"],[role="alertdialog"]')) result.visible.dialogs++;
        if (tag === 'form') result.visible.forms++;
      }
      return result;
    }, maxElements), timeout]);
  } finally { clearTimeout(timer); }
  // Whitelist only the expected scalar fields, even if page code tampers with its DOM APIs.
  const summary = { capturedAt: new Date().toISOString(),
    viewport: Object.fromEntries(['width', 'height', 'deviceScaleFactor', 'scrollX', 'scrollY'].map(key => [key, raw?.viewport?.[key]])),
    visible: Object.fromEntries(countFields.map(key => [key, raw?.visible?.[key]])),
    coverage: { status: 'partial', truncated: raw?.coverage?.truncated, ...Object.fromEntries(coverageFields.map(key => [key, raw?.coverage?.[key]])) } };
  validateDomSummary(summary);
  return summary;
}
