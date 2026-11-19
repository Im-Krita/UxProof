import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
// One shared secret for this dev session: the API requires it on run/cancel/history
// and the UI receives it through Vite's import.meta.env. Never committed.
const devToken = process.env.UXPROOF_DEV_TOKEN || randomBytes(24).toString('hex');
const env = { ...process.env, UXPROOF_DEV_TOKEN: devToken, VITE_UXPROOF_DEV_TOKEN: devToken };
const commands = [['API', process.execPath, ['runner/dev-server.mjs']], ['VITE', process.execPath, [vite, '--host', '127.0.0.1']]];
const processes = [];
let stopping = false;

function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const child of processes) {
    if (!child.pid) continue;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    } else {
      child.kill('SIGTERM');
    }
  }
}

for (const [name, command, args] of commands) {
  const child = spawn(command, args, { stdio: 'inherit', windowsHide: false, env });
  child.on('error', error => {
    if (!stopping) { console.error(`${name}: ${error.message}`); process.exitCode = 1; stopAll(); }
  });
  child.on('exit', code => {
    if (!stopping && code && code !== 0) {
      console.error(`${name} завершился с кодом ${code}`);
      process.exitCode = code;
      stopAll();
    }
  });
  processes.push(child);
}

process.on('SIGINT', () => { stopAll(); process.exit(130); });
process.on('SIGTERM', () => { stopAll(); process.exit(143); });
