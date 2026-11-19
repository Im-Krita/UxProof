import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ConflictError } from '../audit.mjs';
import { acquireRunsLock } from '../audit-lock.mjs';

test('an empty lock file is treated as busy', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-lock-empty-'));
  await fs.writeFile(path.join(dir, '.audit.lock'), '');
  try {
    assert.throws(() => acquireRunsLock(dir), ConflictError);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a live process pid cannot be stolen', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-lock-live-'));
  await fs.writeFile(path.join(dir, '.audit.lock'), String(process.pid));
  try {
    assert.throws(() => acquireRunsLock(dir), ConflictError);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a dead process pid is reclaimed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-lock-dead-'));
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await fs.writeFile(path.join(dir, '.audit.lock'), String(child.pid));
  child.kill();
  await once(child, 'exit');
  try {
    const release = acquireRunsLock(dir);
    release();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a parent that already holds the lock lets its sidecar skip locking', async () => {
  // The desktop app keeps the OS lock for the whole IPC call and writes its own
  // live pid, so a second attempt here would always look like a conflict (BUG-026).
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-lock-held-'));
  await fs.writeFile(path.join(dir, '.audit.lock'), String(process.pid));
  const previous = process.env.UXPROOF_LOCK_HELD;
  try {
    assert.throws(() => acquireRunsLock(dir), ConflictError);
    process.env.UXPROOF_LOCK_HELD = '1';
    const release = acquireRunsLock(dir);
    assert.equal(typeof release, 'function');
    release();
    assert.equal(await fs.readFile(path.join(dir, '.audit.lock'), 'utf8'), String(process.pid), 'parent lock must stay intact');
  } finally {
    if (previous === undefined) delete process.env.UXPROOF_LOCK_HELD;
    else process.env.UXPROOF_LOCK_HELD = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
