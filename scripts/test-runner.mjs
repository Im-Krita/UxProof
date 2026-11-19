import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// A local HTTP_PROXY / NODE_USE_ENV_PROXY must not intercept the loopback dev API
// that some tests start. CI has no proxy, so this changes nothing there.
const loopback = '127.0.0.1,localhost,::1';
const env = {
  ...process.env,
  NO_PROXY: [process.env.NO_PROXY, loopback].filter(Boolean).join(','),
  no_proxy: [process.env.no_proxy, loopback].filter(Boolean).join(',')
};

const testsDir = path.resolve('runner/tests');
const requested = process.argv.slice(2);
const files = requested.length
  ? requested
  : fs.readdirSync(testsDir).filter(name => name.endsWith('.test.mjs')).sort().map(name => path.join(testsDir, name));

const child = spawn(process.execPath, ['--test', ...files], { cwd: path.resolve('.'), env, stdio: 'inherit' });
child.on('exit', code => { process.exitCode = code ?? 1; });
