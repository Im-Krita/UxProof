// Only display an outline when one error event uniquely links this image to valid geometry.
export function screenshotOutline(report, filename, imageWidth, imageHeight) {
  if (!report || report.scenarioEventsVersion !== '0.1' || !Array.isArray(report.scenarioEvents) ||
      typeof filename !== 'string' || !/^[a-zA-Z0-9_-]{1,160}\.png$/.test(filename)) return null;
  const events = report.scenarioEvents.filter(event => event?.phase === 'error' && event.runId === report.runId && event.screenshot === filename);
  if (events.length !== 1) return null;
  const g = events[0].elementGeometry;
  const fields = ['x', 'y', 'width', 'height', 'viewportWidth', 'viewportHeight', 'deviceScaleFactor', 'scrollX', 'scrollY'];
  if (!g || typeof g !== 'object' || fields.some(key => typeof g[key] !== 'number' || !Number.isFinite(g[key])) ||
      g.width <= 0 || g.height <= 0 || g.viewportWidth <= 0 || g.viewportHeight <= 0 ||
      g.deviceScaleFactor <= 0 || g.deviceScaleFactor > 10 ||
      imageWidth !== Math.round(g.viewportWidth * g.deviceScaleFactor) || imageHeight !== Math.round(g.viewportHeight * g.deviceScaleFactor)) return null;
  const left = Math.max(0, g.x), top = Math.max(0, g.y);
  const right = Math.min(g.viewportWidth, g.x + g.width), bottom = Math.min(g.viewportHeight, g.y + g.height);
  if (right <= left || bottom <= top) return null;
  return { left: 100 * left / g.viewportWidth, top: 100 * top / g.viewportHeight,
    width: 100 * (right - left) / g.viewportWidth, height: 100 * (bottom - top) / g.viewportHeight };
}
