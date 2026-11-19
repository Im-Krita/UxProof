import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlan, sanitizePlan } from '../planner.mjs';

test('parsePlan accepts plain JSON and fenced JSON, rejects junk', () => {
  assert.deepEqual(parsePlan('{"steps":[{"type":"click","target":"role:button|Save"}]}').length, 1);
  assert.deepEqual(parsePlan('```json\n{"steps":[{"type":"wait"}]}\n```').length, 1);
  assert.throws(() => parsePlan('no json here'));
  assert.throws(() => parsePlan('{"steps":"nope"}'));
});

test('sanitizePlan drops unknown types, unsafe values and off-origin navigation', () => {
  const base = 'http://127.0.0.1:4180/app';
  const steps = sanitizePlan([
    { type: 'click', name: 'Open', target: 'role:button|Open' },
    { type: 'script', target: 'css:#x' },
    { type: 'fill', target: 'css:#email' },
    { type: 'fill', name: 'Почта', target: 'css:#email', value: 'a@b.c' },
    { type: 'check', name: 'Согласие', target: 'label:Согласен' },
    { type: 'wait', name: 'Пауза', value: '1000' },
    { type: 'navigate', value: 'http://evil.example/x' },
    { type: 'navigate', value: '/settings' },
    { type: 'navigate', value: 'javascript:alert(1)' },
    { type: 'click', target: 'div#not-a-prefix' },
    { type: 'click', target: 'role=equals-not-colon|Save' },
    { type: 'expectText', target: 'css:#status', value: 'Готово' }
  ], base);
  // fill without a value is a valid "clear the field" step, so both fills stay.
  assert.deepEqual(steps.map(step => step.type), ['click', 'fill', 'fill', 'check', 'wait', 'navigate', 'expectText']);
  assert.equal(steps[3].target, 'label:Согласен');
  assert.equal(steps[5].value, '/settings');
});

test('sanitizePlan rejects an invalid base URL', () => {
  assert.throws(() => sanitizePlan([], 'not a url'), /адрес проекта/);
});
