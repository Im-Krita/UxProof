import test from 'node:test';
import assert from 'node:assert/strict';
import { screenshotOutline } from '../geometry-view.mjs';

test('draws only unique screenshot-linked geometry and clips to viewport', () => {
  const geometry = { x: -10, y: 25, width: 30, height: 100, viewportWidth: 100, viewportHeight: 100, deviceScaleFactor: 2, scrollX: 0, scrollY: 10 };
  const event = { phase: 'error', runId: 'r', screenshot: 'error-1.png', elementGeometry: geometry };
  const report = { runId: 'r', scenarioEventsVersion: '0.1', scenarioEvents: [event] };
  assert.deepEqual(screenshotOutline(report, 'error-1.png', 200, 200), { left: 0, top: 25, width: 20, height: 75 });
  assert.equal(screenshotOutline(report, 'error-1.png', 100, 100), null);
  assert.equal(screenshotOutline({ ...report, scenarioEvents: [event, event] }, 'error-1.png', 200, 200), null);
  assert.equal(screenshotOutline(report, '../error-1.png', 200, 200), null);
  assert.equal(screenshotOutline({ ...report, scenarioEvents: [{ ...event, elementGeometry: { ...geometry, x: 101 } }] }, 'error-1.png', 200, 200), null);
  assert.equal(screenshotOutline({ ...report, scenarioEvents: [{ ...event, runId: 'other' }] }, 'error-1.png', 200, 200), null);
});
