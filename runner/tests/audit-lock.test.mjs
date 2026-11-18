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
