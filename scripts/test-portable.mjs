import { spawnSync } from 'node:child_process';

if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Portable test requires Windows x64');
for (const [script, args, extraEnv] of [
  ['scripts/prepare-runtime.mjs', [], {}],
  ['--test', ['runner/tests/bundle.test.mjs', 'runner/tests/runtime-integrity.test.mjs'], { UXPROOF_TEST_PORTABLE: '1' }]
]) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit', env: { ...process.env, ...extraEnv } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
