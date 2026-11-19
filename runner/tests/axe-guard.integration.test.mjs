import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { runAudit } from '../audit.mjs';

// Regression: axe-core/playwright injects its source through a helper about:blank
// page. The audit closes extra pages to stop foreign navigation, so closing that
// helper used to abort every axe run with "Target page ... has been closed" and
// accessibility findings silently disappeared.
test('axe findings survive the extra-page guard', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><html lang="en"><title>Contrast</title>
      <main><p class="low" style="color:#d8dadd;background:#fff">Low contrast text</p>
      <button type="button">Go</button></main></html>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-axe-'));
  const outputDir = path.join(root, 'run');
  try {
    const report = await runAudit({
      runId: 'axe-guard',
      outputDir,
      project: 'axe fixture',
      baseUrl: `http://127.0.0.1:${server.address().port}/`,
      scenarios: [{ id: 's', title: 'contrast', steps: [{ type: 'wait', name: 'wait', value: '1' }] }],
      viewports: [{ id: 'v', width: 390, height: 844 }],
      options: { enableAI: false }
    });
    const contrast = report.issues.filter(issue => issue.kind === 'accessibility' && issue.ruleId === 'color-contrast');
    assert.equal(contrast.length, 1, 'color-contrast should be reported once');
    assert.ok(!report.warnings.some(warning => warning.startsWith('axe ')), `unexpected axe warning: ${report.warnings.join(' | ')}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.rmdir(root).catch(() => {});
  }
});
