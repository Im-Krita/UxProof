import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayViewportLabel, findingIssue } from '../../shared/matching.mjs';
import { humanStepError } from '../validators.mjs';

const observation = (patch) => ({
  observationId: 'o1', runId: 'run', scenarioId: 'server', viewportId: 'mobile', source: 'layout',
  evidence: { screenshot: 'run-1-1.png' }, ...patch
});

test('findingIssue distinguishes overflow issues on different viewports', () => {
  const finding = {
    findingId: 'f', ruleId: 'layout:overflow',
    observations: [
      observation({ observationId: 'mobile-obs', viewportId: 'mobile', evidence: { screenshot: 'run-1-1.png' } }),
      observation({ observationId: 'desktop-obs', viewportId: 'desktop', evidence: { screenshot: 'run-1-2.png' } })
    ]
  };
  const report = {
    results: [
      { id: '0-0', scenario: 'Выбор', viewport: 'Телефон' },
      { id: '0-1', scenario: 'Выбор', viewport: 'Компьютер' }
    ],
    issues: [
      { id: 'LAYOUT-1', kind: 'overflow', ruleId: 'layout:overflow', scenario: 'Выбор', viewport: 'Телефон', screenshot: 'run-1-1.png', scenarioId: 'server', viewportId: 'mobile' },
      { id: 'LAYOUT-2', kind: 'overflow', ruleId: 'layout:overflow', scenario: 'Выбор', viewport: 'Компьютер', screenshot: 'run-1-2.png', scenarioId: 'server', viewportId: 'desktop' }
    ]
  };
  assert.equal(findingIssue(report, finding, 'mobile-obs').id, 'LAYOUT-1');
  assert.equal(findingIssue(report, finding, 'desktop-obs').id, 'LAYOUT-2');
  assert.notEqual(findingIssue(report, finding, 'mobile-obs').id, findingIssue(report, finding, 'desktop-obs').id);
});

test('findingIssue does not match the first javascript issue of any viewport', () => {
  const finding = {
    findingId: 'f', ruleId: 'javascript:pageerror',
    observations: [observation({ source: 'runtime', viewportId: 'tablet', evidence: { screenshot: 'run-1-2.png' } })]
  };
  const report = {
    results: [{ id: '0-1', scenario: 'A', viewport: 'Планшет' }],
    issues: [
      { id: 'JS-1', kind: 'javascript', ruleId: 'javascript:pageerror', scenario: 'A', viewport: 'Телефон', screenshot: 'run-1-1.png', scenarioId: 'server', viewportId: 'mobile' },
      { id: 'JS-2', kind: 'javascript', ruleId: 'javascript:pageerror', scenario: 'A', viewport: 'Планшет', screenshot: 'run-1-2.png', scenarioId: 'server', viewportId: 'tablet' }
    ]
  };
  assert.equal(findingIssue(report, finding, finding.observations[0].observationId).id, 'JS-2');
});

test('legacy reports without ids resolve viewport via screenshot run-S-V.png', () => {
  const finding = {
    findingId: 'f', ruleId: 'layout:overflow',
    observations: [observation({ observationId: 'legacy', viewportId: 'mobile', evidence: { screenshot: 'run-1-1.png' } })]
  };
  const report = {
    results: [{ id: '0-0', scenario: 'Выбор и подключение сервера', viewport: 'Mobile' }],
    issues: [
      { id: 'LAYOUT-1', kind: 'overflow', ruleId: 'layout:overflow', scenario: 'Выбор и подключение сервера', viewport: 'Mobile', screenshot: 'run-1-1.png' },
      { id: 'LAYOUT-2', kind: 'overflow', ruleId: 'layout:overflow', scenario: 'Выбор и подключение сервера', viewport: 'Desktop', screenshot: 'run-1-2.png' }
    ]
  };
  assert.equal(findingIssue(report, finding, 'legacy').id, 'LAYOUT-1');
});

test('displayViewportLabel maps known ids and english labels', () => {
  assert.equal(displayViewportLabel('mobile', 'Mobile'), 'Телефон');
  assert.equal(displayViewportLabel('desktop', ''), 'Компьютер');
  assert.equal(displayViewportLabel(undefined, 'Custom'), 'Custom');
});

test('humanStepError keeps selector and hides raw playwright timeout', () => {
  const text = humanStepError({ name: 'Открыть список серверов', target: 'role:button|Серверы' }, 'locator.click: Timeout 5500ms exceeded.');
  assert.match(text, /Не найден элемент/);
  assert.match(text, /Серверы/);
  assert.doesNotMatch(text, /locator\.click/);
});
