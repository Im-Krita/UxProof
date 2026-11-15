import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { assertAuditableUrl, assertRequestAllowed, decideRequest, isResolvedInside } from '../policy.mjs';

test('loopback проекта разрешён, метаданные нет', async () => {
  await assertAuditableUrl('http://127.0.0.1:4180/', async () => { throw Error('dns'); });
  await assert.rejects(() => assertAuditableUrl('http://169.254.169.254/', async () => []));
});

test('домен не может указывать на link-local', async () => {
  await assert.rejects(
    () => assertAuditableUrl('http://rebind.example/', async () => [{ address: '169.254.169.254', family: 4 }]),
    /служебн/i
  );
});

test('внешний сайт не ходит на localhost и частную сеть', async () => {
  assert.equal(decideRequest('http://127.0.0.1:4180/', 'https://app.example/', false).allow, false);
  assert.equal(decideRequest('http://192.168.1.20/', 'http://127.0.0.1:4180/', true).allow, false);
  assert.equal(decideRequest('http://127.0.0.1:3000/api', 'http://127.0.0.1:4180/', true).allow, true);
  await assert.rejects(() => assertRequestAllowed('http://cdn-private.example/app.js', 'https://app.example/', false, async () => [{ address: '10.1.1.1', family: 4 }]));
  await assertRequestAllowed('http://cdn-public.example/app.js', 'https://app.example/', false, async () => [{ address: '1.1.1.1', family: 4 }]);
});

test('путь отчёта не выходит из каталога', () => {
  const root = path.join(os.tmpdir(), 'uxproof-runs');
  assert.equal(isResolvedInside(root, path.join(root, 'run', 'report.html')), true);
  assert.equal(isResolvedInside(root, path.join(root, '..', 'secret.txt')), false);
});
