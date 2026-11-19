import test from 'node:test';
import assert from 'node:assert/strict';
import { isHistoryReport } from '../history.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const legacy = () => ({ runId: 'legacy', project: 'Relay', baseUrl: 'http://127.0.0.1', startedAt: '2026-11-15T12:00:00Z', durationMs: 1, status: 'completed',
  summary: { totalRuns: 1, passedRuns: 1, failedRuns: 0, confirmedIssues: 0, aiSuggestions: 0, accessibilityIssues: 0 },
  results: [{ id: '0-0', scenario: 's', viewport: 'd', status: 'passed', passedSteps: 1, totalSteps: 1, steps: [{ name: 'step', status: 'passed', durationMs: 1 }] }],
  issues: [], warnings: [] });

test('complete legacy reports and unknown extensions remain readable', () => {
  assert.equal(isHistoryReport(legacy()), true);
  assert.equal(isHistoryReport({ ...legacy(), normalizedSchemaVersion: 'future', extra: {} }), true);
});

test('incomplete or malformed history records are skipped', () => {
  for (const mutate of [
    r => { delete r.startedAt; },
    r => { r.summary = null; },
    r => { r.results[0].steps = null; },
    r => { r.results[0].steps[0].name = {}; },
    r => { r.issues = [{ status: 'confirmed' }]; },
    r => { r.warnings = [null]; },
    r => { r.runId = null; }
  ]) {
    const r = legacy(); mutate(r);
    assert.equal(isHistoryReport(r), false);
  }
  assert.equal(isHistoryReport(null), false);
});

test('history API skips invalid and truncated files while retaining legacy records', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-history-test-'));
  const root = path.join(dir, '.uxproof-data', 'runs');
  for (const name of ['good', 'incomplete', 'truncated']) await fs.mkdir(path.join(root, name), { recursive: true });
  await fs.writeFile(path.join(root, 'good', 'report.json'), JSON.stringify(legacy()));
  await fs.writeFile(path.join(root, 'incomplete', 'report.json'), '{}');
  await fs.writeFile(path.join(root, 'truncated', 'report.json'), '{');
  const serverFile = fileURLToPath(new URL('../dev-server.mjs', import.meta.url));
  const child = spawn(process.execPath, [serverFile], { cwd: dir, env: { ...process.env, UXPROOF_DEV_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const address = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('dev API startup timeout')), 15000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`dev API exited: ${code}`)); });
      child.stdout.on('data', chunk => {
        output += chunk.toString();
        const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
      });
    });
    const response = await fetch(`${address}/api/history`, { headers: { 'X-UXProof-Client': '1' } });
    assert.equal(response.status, 200);
    const page = await response.json();
    assert.equal(page.reports.length, 1);
    assert.equal(page.reports[0].runId, 'legacy');
    assert.equal(page.skipped, 2);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit').catch(() => {});
      child.kill();
      await exited;
    }
    for (const name of ['good', 'incomplete', 'truncated']) {
      await fs.unlink(path.join(root, name, 'report.json'));
      await fs.rmdir(path.join(root, name));
    }
    await fs.rmdir(root);
    await fs.rmdir(path.join(dir, '.uxproof-data'));
    await fs.rmdir(dir);
  }
});
