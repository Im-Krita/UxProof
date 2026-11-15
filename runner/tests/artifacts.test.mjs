import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeArtifactManifest } from '../artifacts.mjs';

test('manifest uses relative paths and hashes actual files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-manifest-test-'));
  const shots = path.join(dir, 'screenshots');
  await fs.mkdir(shots);
  await fs.writeFile(path.join(dir, 'report.json'), '{"ok":true}');
  await fs.writeFile(path.join(dir, 'report.html'), '<p>ok</p>');
  await fs.writeFile(path.join(shots, 'error-1-1-1.png'), 'fixture bytes');
  try {
    const manifest = await writeArtifactManifest(dir, 'run', ['report.json', 'report.html', 'screenshots/error-1-1-1.png', 'report.json']);
    assert.equal(manifest.runId, 'run');
    assert.equal(manifest.artifacts.length, 3);
    const shot = manifest.artifacts.find(item => item.path === 'screenshots/error-1-1-1.png');
    assert.equal(shot.sha256, createHash('sha256').update('fixture bytes').digest('hex'));
    assert.equal(shot.bytes, Buffer.byteLength('fixture bytes'));
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'artifacts.json'), 'utf8')), manifest);
    await assert.rejects(() => writeArtifactManifest(dir, 'run', ['../outside']));
    await assert.rejects(() => writeArtifactManifest(dir, 'run', ['screenshots/missing.png']));
  } finally {
    await fs.unlink(path.join(shots, 'error-1-1-1.png'));
    await fs.rmdir(shots);
    for (const filename of ['report.json', 'report.html', 'artifacts.json']) await fs.unlink(path.join(dir, filename)).catch(() => {});
    await fs.rmdir(dir);
  }
});

test('manifest refuses a screenshot directory redirected outside the run root', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-manifest-root-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'uxproof-manifest-outside-'));
  const link = path.join(root, 'screenshots');
  await fs.writeFile(path.join(outside, 'leak.png'), 'fixture');
  let linked = false;
  try {
    try { await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); linked = true; }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('Directory links are unavailable in this environment'); return; }
      throw error;
    }
    await assert.rejects(() => writeArtifactManifest(root, 'run', ['screenshots/leak.png']), /каталог отчёта/);
  } finally {
    if (linked) await fs.unlink(link).catch(() => fs.rmdir(link));
    await fs.unlink(path.join(outside, 'leak.png'));
    await fs.rmdir(outside);
    await fs.rmdir(root);
  }
});
