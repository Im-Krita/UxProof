import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScenarioEvents } from '../events.mjs';

const report = () => ({ runId: 'r', scenarioEventsVersion: '0.1', results: [{ id: '0-0', steps: [{ index: 1, type: 'click', status: 'failed', screenshot: 'error-1-1-1.png' }] }],
  scenarioEvents: ['before', 'action', 'error'].map((phase, index) => ({ eventId: `e${index}`, runId: 'r', combinationId: '0-0', scenarioId: 's', viewportId: 'v', stepId: '1', stepType: 'click', phase, at: '2026-11-15T12:00:00.000Z', ...(phase === 'error' ? { screenshot: 'error-1-1-1.png' } : {}) })) });

test('validates event sequence and accepts old reports without events', () => {
  assert.equal(validateScenarioEvents(report()), true);
  assert.equal(validateScenarioEvents({ version: 1 }), true);
});

test('rejects inconsistent event IDs, phases, result links and screenshots', () => {
  for (const mutate of [
    r => { r.scenarioEvents[1].eventId = r.scenarioEvents[0].eventId; },
    r => { r.scenarioEvents[1].phase = 'after'; },
    r => { r.scenarioEvents[2].screenshot = '../secret.png'; },
    r => { r.scenarioEvents[2].screenshot = 'another.png'; },
    r => { r.scenarioEvents[2].runId = 'other'; },
    r => { r.scenarioEvents.pop(); },
    r => { r.scenarioEventsVersion = 'future'; }
  ]) {
    const value = report(); mutate(value);
    assert.throws(() => validateScenarioEvents(value));
  }
});
