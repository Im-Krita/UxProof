// All form values and opaque surfaces are masked before persistence or model use.
export function screenshotWithRedaction(page, options = {}, { maskTextValues = [] } = {}) {
  if (!Array.isArray(maskTextValues) || maskTextValues.length > 60 ||
      maskTextValues.some(value => typeof value !== 'string' || value.length > 2000)) throw TypeError('Invalid screenshot redaction values');
  // The browser context is fresh for each scenario. Match literals rather than regexes, and
  // mask even short values: this may conceal unrelated text but avoids exposing the value.
  const textMasks = [...new Set(maskTextValues.filter(value => value.trim()))].map(value => page.getByText(value, { exact: false }));
  return page.screenshot({
    ...options,
    animations: 'disabled',
    mask: [page.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"]), iframe, canvas, video'), ...textMasks],
    maskColor: '#000000'
  });
}
