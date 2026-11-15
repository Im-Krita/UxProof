import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('runtime preparation rejects altered Chromium without deleting the previous runtime', { skip: process.platform !== 'win32' || process.env.UXPROOF_TEST_PORTABLE !== '1' }, async () => {
  const project = fileURLToPath(new URL('../..', import.meta.url));
  const manifest = JSON.parse(await fs.readFile(path.join(project, 'scripts/runtime-manifests/chromium-headless-win64-1255.json'), 'utf8'));
  const fake = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-tampered-cache-'));
  const browser = path.join(fake, `chromium_headless_shell-${manifest.revision}`), shell = path.join(browser, 'chrome-headless-shell-win64');
  const previousNode = path.join(project, '.uxproof-build/runtime/node.exe');
  const previousInfo = await fs.stat(previousNode);
  try {
    await fs.mkdir(shell, { recursive: true });
    await fs.writeFile(path.join(browser, 'INSTALLATION_COMPLETE'), '');
    await fs.writeFile(path.join(shell, 'chrome-headless-shell.exe'), 'not an executable');
    await fs.writeFile(path.join(shell, 'ABOUT'), 'tampered');
    const result = spawnSync(process.execPath, ['scripts/prepare-runtime.mjs'], { cwd: project, encoding: 'utf8',
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: fake, UXPROOF_NODE_BINARY: process.execPath } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Chromium cache does not match verified archive/);
    const after = await fs.stat(previousNode);
    assert.equal(after.size, previousInfo.size);
    assert.equal(after.mtimeMs, previousInfo.mtimeMs);
  } finally {
    await fs.unlink(path.join(shell, 'ABOUT'));
    await fs.unlink(path.join(shell, 'chrome-headless-shell.exe'));
    await fs.unlink(path.join(browser, 'INSTALLATION_COMPLETE'));
    await fs.rmdir(shell); await fs.rmdir(browser); await fs.rmdir(fake);
  }
});
