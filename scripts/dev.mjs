import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const commands = [['API', process.execPath, ['runner/dev-server.mjs']], ['VITE', npm, ['run', 'dev:ui']]];
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
  const child = spawn(command, args, { stdio: 'inherit', windowsHide: false });
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
