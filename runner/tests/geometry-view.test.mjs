import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceCaption, evidenceGeometry, screenshotOutline } from '../../shared/geometry-view.mjs';

const geometry = { x: -10, y: 25, width: 30, height: 100, viewportWidth: 100, viewportHeight: 100, deviceScaleFactor: 2, scrollX: 0, scrollY: 10 };
const event = { phase: 'error', runId: 'r', screenshot: 'error-1.png', elementGeometry: geometry };
const report = { runId: 'r', scenarioEventsVersion: '0.1', scenarioEvents: [event] };

test('draws only unique screenshot-linked geometry and clips to viewport', () => {
  assert.deepEqual(screenshotOutline(report, 'error-1.png', 200, 200), { left: 0, top: 25, width: 20, height: 75 });
  assert.equal(screenshotOutline(report, 'error-1.png', 100, 100), null);
  assert.equal(screenshotOutline({ ...report, scenarioEvents: [event, event] }, 'error-1.png', 200, 200), null);
  assert.equal(screenshotOutline(report, '../error-1.png', 200, 200), null);
  assert.equal(screenshotOutline({ ...report, scenarioEvents: [{ ...event, elementGeometry: { ...geometry, x: 101 } }] }, 'error-1.png', 200, 200), null);
  assert.equal(screenshotOutline({ ...report, scenarioEvents: [{ ...event, runId: 'other' }] }, 'error-1.png', 200, 200), null);
});

test('distinguishes absent geometry from a viewport×DPR mismatch', () => {
  assert.equal(evidenceGeometry(report, 'error-1.png', 200, 200).status, 'ok');
  assert.equal(evidenceGeometry({ ...report, scenarioEvents: [] }, 'error-1.png', 200, 200).status, 'absent');
  assert.equal(evidenceGeometry(report, 'other.png', 200, 200).status, 'absent');
  const mismatch = evidenceGeometry(report, 'error-1.png', 200, 150);
  assert.equal(mismatch.status, 'mismatch');
  assert.equal(mismatch.outline, undefined);
  assert.equal(mismatch.geometry.viewportWidth, 100);
});

test('caption reports viewport size and device pixel ratio only', () => {
  assert.equal(evidenceCaption(geometry), 'Экран 100×100 CSS px · DPR 2');
  assert.equal(evidenceCaption(null), null);
  assert.equal(evidenceCaption({ ...geometry, deviceScaleFactor: 0 }), null);
  assert.ok(!evidenceCaption(geometry).includes('synthetic'));
});
