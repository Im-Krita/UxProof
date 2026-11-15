import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireAuditLock } from '../audit.mjs';

test('вторая проверка не стартует, пока первая не освободила браузер', () => {
  const release = acquireAuditLock();
  try {
    assert.throws(() => acquireAuditLock(), /другая проверка/);
  } finally {
    release();
  }
  const again = acquireAuditLock();
  again();
});
