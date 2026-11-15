import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('CLI accepts configuration through stdin without an input file', () => {
  const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '-'], { input: 'null', encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Не задана конфигурация/);
  assert.doesNotMatch(result.stderr, /ENOENT|Usage:/);
});

test('CLI continues to accept configuration files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uxproof-cli-test-'));
  const input = path.join(dir, 'input.json');
  try {
    fs.writeFileSync(input, 'null');
    const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [cli, input], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Не задана конфигурация/);
  } finally {
    fs.unlinkSync(input);
    fs.rmdirSync(dir);
  }
});
