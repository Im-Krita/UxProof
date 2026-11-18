import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { CancelledError, IdleError, cancelRunningAudit, runAudit } from '../audit.mjs';

describe('cancel', { concurrency: false }, () => {
  test('cancel without a run is idle', () => {
    assert.throws(() => cancelRunningAudit(), IdleError);
  });

  test('dev API cancel without a run returns 409 and stays up', async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-cancel-api-'));
    const child = spawn(process.execPath, [path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dev-server.mjs')], {
      cwd: temp,
      env: { ...process.env, UXPROOF_DEV_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    try {
      const port = await Promise.race([
        new Promise(resolve => {
          const read = () => {
            const match = output.match(/127\.0\.0\.1:(\d+)/);
            if (match) resolve(Number(match[1]));
          };
          child.stdout.on('data', read);
          child.stderr.on('data', read);
          read();
        }),
        once(child, 'exit').then(() => { throw Error(output || 'dev API exited'); })
      ]);
      const response = await fetch(`http://127.0.0.1:${port}/api/cancel`, {
        method: 'POST', headers: { 'X-UXProof-Client': '1' }, signal: AbortSignal.timeout(8000)
      });
      const body = await response.json();
      assert.equal(response.status, 409);
      assert.match(body.error, /Нет выполняющейся проверки/);
      const history = await fetch(`http://127.0.0.1:${port}/api/history`, { signal: AbortSignal.timeout(8000) });
      assert.equal(history.status, 200);
    } finally {
      child.kill();
      await once(child, 'exit').catch(() => {});
      await fs.rm(temp, { recursive: true, force: true });
    }
  });

  test('in-process cancel stops Chromium without writing a report', async () => {
    const hung = http.createServer(() => {});
    hung.listen(0, '127.0.0.1');
    await once(hung, 'listening');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-cancel-run-'));
    try {
      const pending = runAudit({
        project: 'cancel', baseUrl: `http://127.0.0.1:${hung.address().port}/`,
        scenarios: [{ id: 's', title: 'cancel', steps: [{ type: 'wait', name: 'wait', value: '30000' }] }],
        viewports: [{ id: 'v', width: 390, height: 844 }],
        options: { enableAI: false }, outputDir: dir, runId: 'cancel-run'
      });
      await new Promise(resolve => setTimeout(resolve, 800));
      cancelRunningAudit();
      await assert.rejects(() => pending, CancelledError);
      await assert.rejects(() => fs.access(path.join(dir, 'report.json')));
    } finally {
      await new Promise(resolve => hung.close(resolve));
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('aborting POST /api/run releases the lock', async () => {
    const hung = http.createServer(() => {});
    hung.listen(0, '127.0.0.1');
    await once(hung, 'listening');
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-abort-lock-'));
    const child = spawn(process.execPath, [path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dev-server.mjs')], {
      cwd: temp,
      env: { ...process.env, UXPROOF_DEV_PORT: '0', UXPROOF_MAX_MS: '20000' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    try {
      const port = await Promise.race([
        new Promise(resolve => {
          const read = () => {
            const match = output.match(/127\.0\.0\.1:(\d+)/);
            if (match) resolve(Number(match[1]));
          };
          child.stdout.on('data', read);
          child.stderr.on('data', read);
          read();
        }),
        once(child, 'exit').then(() => { throw Error(output || 'dev API exited'); })
      ]);
      const payload = {
        project: 'abort', baseUrl: `http://127.0.0.1:${hung.address().port}/`,
        scenarios: [{ id: 's', title: 's', steps: [{ type: 'wait', name: 'wait', target: '', value: '30000' }] }],
        viewports: [{ id: 'v', label: 'v', width: 390, height: 844 }],
        options: { enableAI: false }
      };
      const abort = new AbortController();
      const pending = fetch(`http://127.0.0.1:${port}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-UXProof-Client': '1' },
        body: JSON.stringify(payload),
        signal: abort.signal
      });
      await new Promise(resolve => setTimeout(resolve, 900));
      abort.abort();
      await pending.catch(() => {});
      let status = 0;
      for (let attempt = 0; attempt < 20; attempt++) {
        const idle = await fetch(`http://127.0.0.1:${port}/api/cancel`, {
          method: 'POST', headers: { 'X-UXProof-Client': '1' }, signal: AbortSignal.timeout(8000)
        });
        status = idle.status;
        if (status === 409) break;
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      assert.equal(status, 409);
    } finally {
      child.kill();
      await once(child, 'exit').catch(() => {});
      await new Promise(resolve => hung.close(resolve));
      await fs.rm(temp, { recursive: true, force: true });
    }
  });
});
