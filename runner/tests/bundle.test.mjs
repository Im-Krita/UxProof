import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('bundle does not include the entire runner directory or local environment files', async () => {
  const config = JSON.parse(await fs.readFile(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const resources = config.bundle.resources;
  assert.ok(resources && !Array.isArray(resources));
  assert.ok(!Object.keys(resources).some(source => /^\.\.\/runner\/?$/.test(source)));
  assert.ok(!Object.keys(resources).some(source => /\.env/i.test(source)));
  assert.equal(resources['../runner/cli.mjs'], 'runner/cli.mjs');
  assert.equal(resources['../runner/audit.mjs'], 'runner/audit.mjs');
  const lock = JSON.parse(await fs.readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
  for (const name of Object.keys(lock.packages).filter(name => name.startsWith('node_modules/'))) {
    assert.equal(resources[`../runner/${name}/`], `runner/${name}/`, `missing locked dependency ${name}`);
  }
  const pending = ['cli.mjs'], checked = new Set();
  while (pending.length) {
    const name = pending.pop();
    if (checked.has(name)) continue;
    checked.add(name);
    assert.equal(resources[`../runner/${name}`], `runner/${name}`, `missing runner module ${name}`);
    const text = await fs.readFile(new URL(`../${name}`, import.meta.url), 'utf8');
    for (const match of text.matchAll(/\bfrom\s+['"]\.\/([^'"]+\.mjs)['"]/g)) pending.push(match[1]);
  }
});

test('explicit bundle resources run a real audit outside the checkout', { timeout: 60000 }, async () => {
  const tempRoot = await fs.realpath(os.tmpdir());
  const stage = await fs.mkdtemp(path.join(tempRoot, 'uxproof-bundle-test-'));
  const realStage = await fs.realpath(stage);
  const relativeStage = path.relative(tempRoot, realStage);
  if (!relativeStage.startsWith('uxproof-bundle-test-') || relativeStage.includes(path.sep) || path.isAbsolute(relativeStage)) {
    throw Error('Unsafe temporary test directory');
  }
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><html lang="en"><title>Fixture</title><main id="ok">Ready</main></html>'); });
  try {
    const config = JSON.parse(await fs.readFile(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
    const configDir = fileURLToPath(new URL('../../src-tauri/', import.meta.url));
    for (const [source, target] of Object.entries(config.bundle.resources)) {
      if (source.includes('*')) continue; // Schemas are not executed by the runner.
      const dest = path.resolve(realStage, target);
      const relative = path.relative(realStage, dest);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Unsafe bundle path');
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.cp(path.resolve(configDir, source), dest, { recursive: true });
    }
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const audit = { runId: 'packaging-test', outputDir: path.join(realStage, 'output'), project: 'fixture', baseUrl: `http://127.0.0.1:${server.address().port}/`,
      scenarios: [{ id: 's', title: 'fixture', steps: [{ type: 'expectVisible', target: 'css:#ok', name: 'Visible' }] }],
      viewports: [{ id: 'v', width: 390, height: 844 }], options: { enableAI: false } };
    const child = spawn(process.execPath, [path.join(realStage, 'runner', 'cli.mjs'), '-'], { cwd: realStage, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.stdin.end(JSON.stringify(audit));
    const [code] = await once(child, 'close');
    assert.equal(code, 0, stderr);
    assert.equal(JSON.parse(stdout).summary.passedRuns, 1);
    assert.ok((await fs.stat(path.join(realStage, 'output', 'report.html'))).size > 0);
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    // The resolved target was checked to be one freshly created directory under the system temp root.
    await fs.rm(realStage, { recursive: true, force: true });
  }
});
