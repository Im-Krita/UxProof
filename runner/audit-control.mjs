// Single source of truth for "is an audit running" across the CLI, the dev API
// and the Tauri IPC worker. Cancellation closes the active browser; the lock
// keeps a second caller from starting a parallel run in the same process.
let runActive = false;
let activeBrowser = null;
let shutdownBound = false;
let cancelRequested = false;

export class ConflictError extends Error {
  constructor() {
    super('Уже выполняется другая проверка. Дождитесь её завершения.');
    this.name = 'ConflictError';
  }
}

export class IdleError extends Error {
  constructor() {
    super('Нет выполняющейся проверки');
    this.name = 'IdleError';
  }
}

export class CancelledError extends Error {
  constructor() {
    super('Проверка остановлена');
    this.name = 'CancelledError';
  }
}

export const isCancelRequested = () => cancelRequested;
export const resetCancel = () => { cancelRequested = false; };

export function setActiveBrowser(browser) {
  activeBrowser = browser;
  bindShutdown();
}
export function clearActiveBrowser() { activeBrowser = null; }

export function cancelRunningAudit() {
  if (!runActive) throw new IdleError();
  cancelRequested = true;
  const browser = activeBrowser;
  if (browser) browser.close().catch(() => {});
}

export function acquireAuditLock() {
  if (runActive) throw new ConflictError();
  runActive = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    runActive = false;
  };
}

function bindShutdown() {
  if (shutdownBound) return;
  shutdownBound = true;
  const stop = () => {
    const browser = activeBrowser;
    activeBrowser = null;
    const closing = browser ? browser.close().catch(() => {}) : Promise.resolve();
    closing.finally(() => process.exit(130));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
