import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { assertAuditableUrl, assertRequestAllowed, decideRequest, isResolvedInside, isLinkLocalHost, isMulticastHost, prepareBasePolicy } from '../policy.mjs';

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

test('IPv4-mapped IPv6 and the whole IPv6 link-local range follow the same policy', async () => {
  const base = 'https://public.example/';
  assert.equal(decideRequest('http://[::ffff:127.0.0.1]/', base, false).allow, false);
  assert.equal(decideRequest('http://[::ffff:10.0.0.1]/', base, false).allow, false);
  assert.equal(decideRequest('http://[::a00:1]/', base, false).allow, false);
  assert.equal(decideRequest('http://[64:ff9b::a00:1]/', base, false).allow, false);
  assert.equal(decideRequest('http://[64:ff9b::808:808]/', base, false).allow, true);
  assert.equal(decideRequest('http://240.0.0.1/', base, false).allow, false);
  assert.equal(decideRequest('http://0x7f000001/', base, false).allow, false);
  assert.equal(decideRequest('http://[fe90::1]/', base, false).allow, false);
  assert.equal(decideRequest('http://[::]/', base, false).allow, false);
  assert.equal(decideRequest('http://[ff02::1]/', base, false).allow, false);
  assert.equal(isLinkLocalHost('febf::1'), true);
  assert.equal(isLinkLocalHost('fec0::1'), false);
  assert.equal(isMulticastHost('ffcdn.example'), false);
  await assert.rejects(() => assertAuditableUrl('http://[::ffff:169.254.169.254]/'));
  await assert.rejects(() => assertAuditableUrl('http://[64:ff9b::a9fe:a9fe]/'));
  await assert.rejects(() => assertAuditableUrl('http://metadata.google.internal../'));
});

test('DNS answers are not cached across requests or audits', async () => {
  let calls = 0;
  const changing = async () => [{ address: ++calls === 1 ? '1.1.1.1' : '10.0.0.1', family: 4 }];
  await assertRequestAllowed('https://changing-cdn.example/a', 'https://public.example/', false, changing);
  await assert.rejects(() => assertRequestAllowed('https://changing-cdn.example/b', 'https://public.example/', false, changing));
  let audits = 0;
  const changingBase = async () => [{ address: ++audits === 1 ? '1.1.1.1' : '169.254.169.254', family: 4 }];
  await assertAuditableUrl('https://changing-base.example/', changingBase);
  await assert.rejects(() => assertAuditableUrl('https://changing-base.example/', changingBase));
});

test('base hostname must keep its initially approved addresses for each request', async () => {
  const base = 'https://base-rebinding.example/';
  let calls = 0;
  const lookup = async () => [{ address: ++calls === 1 ? '1.1.1.1' : '10.0.0.1', family: 4 }];
  const policy = await prepareBasePolicy(base, lookup);
  await assert.rejects(() => assertRequestAllowed(base, base, policy.baseLoopback, lookup, policy.addresses), /изменил/i);
  const privateLookup = async () => [{ address: '192.168.1.10', family: 4 }];
  const privatePolicy = await prepareBasePolicy('http://private-app.example/', privateLookup);
  await assertRequestAllowed('http://private-app.example/x', 'http://private-app.example/', privatePolicy.baseLoopback, privateLookup, privatePolicy.addresses);
  const mixedLookup = async () => [{ address: '1.1.1.1', family: 4 }, { address: '10.0.0.1', family: 4 }];
  await assert.rejects(() => prepareBasePolicy('http://mixed-base.example/', mixedLookup), /смешан/i);
});

test('unresponsive DNS lookup is bounded', { timeout: 8000 }, async () => {
  await assert.rejects(() => prepareBasePolicy('https://timeout.example/', () => new Promise(() => {})), /разрешить адрес/i);
});
