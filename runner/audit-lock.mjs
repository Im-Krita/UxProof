import fs from 'node:fs';
import path from 'node:path';
import { ConflictError } from './audit.mjs';

const STALE_MS = 20 * 60 * 1000;

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function lockOwner(lockPath) {
  let raw;
  try { raw = fs.readFileSync(lockPath, 'utf8').trim(); } catch { return { pid: 0, mtimeMs: 0 }; }
  const pid = Number(raw);
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(lockPath).mtimeMs; } catch { /* missing file is handled by the caller */ }
  return { pid: Number.isInteger(pid) ? pid : 0, mtimeMs };
}

function canReclaim(owner) {
  if (processAlive(owner.pid)) return false;
  if (owner.pid > 0) return true;
  return owner.mtimeMs > 0 && Date.now() - owner.mtimeMs > STALE_MS;
}

// One runs root for the CLI, the dev API and a debug Tauri build. A packaged
// build resolves the same environment variable, so all three share one lock.
export function defaultRunsDir() {
  const configured = process.env.UXPROOF_RUNS_DIR;
  if (typeof configured === 'string' && configured.trim()) return path.resolve(configured);
  return path.resolve('.uxproof-data/runs');
}

export function acquireRunsLock(runsDir = defaultRunsDir()) {
  fs.mkdirSync(runsDir, { recursive: true });
  const lockPath = path.join(runsDir, '.audit.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd;
    try {
      fd = fs.openSync(lockPath, 'wx');
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const owner = lockOwner(lockPath);
      if (!canReclaim(owner)) throw new ConflictError();
      try { fs.unlinkSync(lockPath); }
      catch (unlinkError) { if (unlinkError?.code !== 'ENOENT') throw new ConflictError(); }
      continue;
    }
    fs.writeFileSync(fd, String(process.pid));
    return () => {
      try { fs.closeSync(fd); } catch { /* the handle is already closed */ }
      try {
        if (Number(fs.readFileSync(lockPath, 'utf8')) === process.pid) fs.unlinkSync(lockPath);
      } catch { /* a replaced lock belongs to the next owner */ }
    };
  }
  throw new ConflictError();
}

// Exclusive lock in the parent of outputDir, which is the runs directory for both the dev API and the CLI.
export function acquireRunDirectoryLock(outputDir) {
  if (typeof outputDir !== 'string' || !outputDir.trim()) return acquireRunsLock();
  return acquireRunsLock(path.resolve(outputDir, '..'));
}
