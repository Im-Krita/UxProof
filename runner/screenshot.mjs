// All form values and opaque surfaces are masked before persistence or model use.
export function screenshotWithRedaction(page, options = {}) {
  return page.screenshot({
    ...options,
    animations: 'disabled',
    mask: [page.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"]), iframe, canvas, video')],
    maskColor: '#000000'
  });
}
