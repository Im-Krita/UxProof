import { locatorFor } from './validators.mjs';

const fields = ['x', 'y', 'width', 'height', 'viewportWidth', 'viewportHeight', 'deviceScaleFactor', 'scrollX', 'scrollY'];
export function validateElementGeometry(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key) &&
      typeof value[key] === 'number' && Number.isFinite(value[key]) && Math.abs(value[key]) <= 1e7) &&
    value.width > 0 && value.height > 0 && value.viewportWidth > 0 && value.viewportHeight > 0 &&
    value.deviceScaleFactor > 0 && value.deviceScaleFactor <= 10);
}

// Geometry is viewport-relative in CSS pixels. No page text, selectors or values are stored.
export async function collectElementGeometry(page, target, { timeoutMs = 2000 } = {}) {
  if (typeof target !== 'string' || !target || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) return null;
  let timer;
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Geometry timeout')), timeoutMs); });
    const raw = await Promise.race([locatorFor(page, target).evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
        deviceScaleFactor: window.devicePixelRatio, scrollX: window.scrollX, scrollY: window.scrollY };
    }, null, { timeout: timeoutMs }), timeout]);
    const geometry = Object.fromEntries(fields.map(key => [key, raw?.[key]]));
    return validateElementGeometry(geometry) ? geometry : null;
  } catch { return null; } finally { clearTimeout(timer); }
}
