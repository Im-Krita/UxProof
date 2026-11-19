// Screenshot evidence is only tied to geometry when exactly one error event
// links this image to a valid, matching measurement.
const fields = ['x', 'y', 'width', 'height', 'viewportWidth', 'viewportHeight', 'deviceScaleFactor', 'scrollX', 'scrollY'];

function validGeometry(g) {
  return Boolean(g && typeof g === 'object' && !Array.isArray(g) &&
    fields.every(key => typeof g[key] === 'number' && Number.isFinite(g[key])) &&
    g.width > 0 && g.height > 0 && g.viewportWidth > 0 && g.viewportHeight > 0 &&
    g.deviceScaleFactor > 0 && g.deviceScaleFactor <= 10);
}

function eventFor(report, filename) {
  if (!report || report.scenarioEventsVersion !== '0.1' || !Array.isArray(report.scenarioEvents) ||
      typeof filename !== 'string' || !/^[a-zA-Z0-9_-]{1,160}\.png$/.test(filename)) return null;
  const events = report.scenarioEvents.filter(event => event?.phase === 'error' && event.runId === report.runId && event.screenshot === filename);
  return events.length === 1 ? events[0] : null;
}

// Returns { status, geometry?, outline? }:
// 'absent'  — the image has no single linked measurement;
// 'mismatch'— measurement exists but the rendered image size does not match viewport×DPR;
// 'ok'      — outline can be drawn.
export function evidenceGeometry(report, filename, imageWidth, imageHeight) {
  const event = eventFor(report, filename);
  if (!event || !validGeometry(event.elementGeometry)) return { status: 'absent' };
  const g = event.elementGeometry;
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0 ||
      imageWidth !== Math.round(g.viewportWidth * g.deviceScaleFactor) ||
      imageHeight !== Math.round(g.viewportHeight * g.deviceScaleFactor)) {
    return { status: 'mismatch', geometry: g };
  }
  const left = Math.max(0, g.x), top = Math.max(0, g.y);
  const right = Math.min(g.viewportWidth, g.x + g.width), bottom = Math.min(g.viewportHeight, g.y + g.height);
  if (right <= left || bottom <= top) return { status: 'absent', geometry: g };
  return {
    status: 'ok', geometry: g,
    outline: { left: 100 * left / g.viewportWidth, top: 100 * top / g.viewportHeight,
      width: 100 * (right - left) / g.viewportWidth, height: 100 * (bottom - top) / g.viewportHeight }
  };
}

export function evidenceCaption(geometry) {
  if (!validGeometry(geometry)) return null;
  return `Экран ${Math.round(geometry.viewportWidth)}×${Math.round(geometry.viewportHeight)} CSS px · DPR ${geometry.deviceScaleFactor}`;
}

// Only display an outline when one error event uniquely links this image to valid geometry.
export function screenshotOutline(report, filename, imageWidth, imageHeight) {
  return evidenceGeometry(report, filename, imageWidth, imageHeight).outline || null;
}
