import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const runnerDir = dirname(dirname(fileURLToPath(import.meta.url)));
const serverPath = join(runnerDir, 'dev-server.mjs');
const TOKEN = 'test-dev-token-123';

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath], {
      cwd: runnerDir,
      env: { ...process.env, UXPROOF_DEV_TOKEN: TOKEN, UXPROOF_DEV_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => reject(new Error('server did not start in time')), 15_000);
    timer.unref();
    const onData = (chunk) => {
      out += chunk.toString();
      const match = out.match(/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolve({ child, port: Number(match[1]) });
      }
    };
    child.stdout.on('data', onData);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (!out.includes('127.0.0.1:')) reject(new Error(`server exited early with code ${code}: ${out}`));
    });
  });
}

function api(port, path, { token, method = 'GET', body } = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      'X-UXProof-Client': '1',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test('dev server rejects requests without the configured token', async () => {
  const { child, port } = await startServer();
  try {
    const noHeader = await api(port, '/api/history');
    assert.equal(noHeader.status, 403);

    const wrongToken = await api(port, '/api/history', { token: 'nope' });
    assert.equal(wrongToken.status, 403);

    const missingClientHeader = await fetch(`http://127.0.0.1:${port}/api/history`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(missingClientHeader.status, 403);

    const ok = await api(port, '/api/history', { token: TOKEN });
    assert.equal(ok.status, 200);
  } finally {
    child.kill();
  }
});
