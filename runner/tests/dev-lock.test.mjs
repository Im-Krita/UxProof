import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { acquireRunDirectoryLock } from '../audit-lock.mjs';

const devServer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dev-server.mjs');

test('a second dev API process reports that an audit is already running', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-dev-lock-'));
  const runs = path.join(temp, '.uxproof-data', 'runs');
  await fs.mkdir(runs, { recursive: true });
  const release = acquireRunDirectoryLock(path.join(runs, 'holder'));
  const child = spawn(process.execPath, [devServer], {
    cwd: temp,
    env: { ...process.env, UXPROOF_DEV_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  try {
    const ready = await Promise.race([
      new Promise(resolve => {
        const read = () => {
          const match = output.match(/127\.0\.0\.1:(\d+)/);
          if (match) resolve(Number(match[1]));
        };
        child.stdout.on('data', read);
        child.stderr.on('data', read);
        read();
      }),
      once(child, 'exit').then(() => { throw Error(output || 'dev API exited before listening'); })
    ]);
    const response = await fetch(`http://127.0.0.1:${ready}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-uxproof-client': '1' },
      body: JSON.stringify({
        project: 'lock', baseUrl: 'http://127.0.0.1:9/',
        scenarios: [{ id: 's', title: 'lock', steps: [{ type: 'wait', name: 'wait', value: '1' }] }],
        viewports: [{ id: 'v', width: 390, height: 844 }], options: { enableAI: false }
      }),
      signal: AbortSignal.timeout(8000)
    });
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.match(body.error, /Уже выполняется другая проверка/);
  } finally {
    release();
    child.kill();
    await once(child, 'exit').catch(() => {});
    await fs.rm(temp, { recursive: true, force: true });
  }
});
