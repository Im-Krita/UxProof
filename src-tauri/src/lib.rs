// Desktop entry point: one in-process audit lock, one cross-process file lock
// next to the runs directory, and the IPC command surface.
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};

mod commands;
mod spawn;
mod url;

use spawn::process_alive;
use url::remove_legacy_input_files;
struct AuditLock(AtomicBool);

impl AuditLock {
    const fn new() -> Self { Self(AtomicBool::new(false)) }

    fn acquire(&self) -> Result<AuditGuard<'_>, String> {
        self.0.compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .map(|_| AuditGuard(self))
            .map_err(|_| "Уже выполняется другая проверка. Дождитесь её завершения.".into())
    }
}

struct AuditGuard<'a>(&'a AuditLock);

impl Drop for AuditGuard<'_> {
    fn drop(&mut self) { self.0.0.store(false, Ordering::Release); }
}

pub(crate) static AUDIT_LOCK: AuditLock = AuditLock::new();

struct FileLock {
    file: Option<File>,
    path: std::path::PathBuf,
}

impl Drop for FileLock {
    fn drop(&mut self) {
        self.file.take();
        let _ = fs::remove_file(&self.path);
    }
}

fn lock_audit_file(root: &Path) -> Result<FileLock, String> {
    let path = root.join(".audit.lock");
    // Mirrors runner/audit-lock.mjs: create exclusively first; only an existing
    // lock is inspected. An empty lock stays busy until it is 20 minutes old,
    // a live pid is never stolen, a dead pid is reclaimed immediately.
    let mut file = match OpenOptions::new().read(true).write(true).create_new(true).open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let mut existing = OpenOptions::new().read(true).write(true).open(&path)
                .map_err(|e| format!("Не удалось открыть блокировку проверки: {e}"))?;
            let mut owner_text = String::new();
            existing.read_to_string(&mut owner_text).map_err(|e| format!("Не удалось прочитать блокировку проверки: {e}"))?;
            let owner: u32 = owner_text.trim().parse().unwrap_or(0);
            let reclaimable = if owner == 0 {
                let age = fs::metadata(&path).ok().and_then(|meta| meta.modified().ok()).and_then(|time| time.elapsed().ok());
                matches!(age, Some(age) if age.as_millis() > 20 * 60 * 1000)
            } else {
                owner != std::process::id() && !process_alive(owner)
            };
            if !reclaimable {
                return Err("Уже выполняется другая проверка. Дождитесь её завершения.".into());
            }
            fs::remove_file(&path).map_err(|e| format!("Не удалось снять устаревшую блокировку: {e}"))?;
            OpenOptions::new().read(true).write(true).create_new(true).open(&path)
                .map_err(|e| format!("Не удалось создать блокировку проверки: {e}"))?
        }
        Err(error) => return Err(format!("Не удалось создать блокировку проверки: {error}")),
    };
    file.try_lock().map_err(|e| format!("Не удалось получить блокировку проверки: {e}"))?;
    write!(&file, "{}", std::process::id()).map_err(|e| format!("Не удалось записать блокировку проверки: {e}"))?;
    file.flush().map_err(|e| format!("Не удалось записать блокировку проверки: {e}"))?;
    Ok(FileLock { file: Some(file), path })
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Legacy builds wrote the run configuration to input.json inside the
            // runs directory. It is never read any more, so remove leftovers on start.
            if let Ok(root) = commands::report_root(app.handle()) {
                remove_legacy_input_files(&root);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::run_audit,
            commands::cancel_audit,
            commands::list_reports,
            commands::read_screenshot,
            commands::export_html,
            commands::export_trace,
            commands::export_xlsx,
            commands::plan_steps
        ])
        .build(tauri::generate_context!())
        .expect("error running UXProof")
        .run(|_app, event| {
            if matches!(event, tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }) {
                spawn::kill_running_audit();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn audit_lock_rejects_parallel_work_and_releases_after_errors() {
        let lock = AuditLock::new();
        let first = lock.acquire().unwrap();
        assert!(lock.acquire().is_err());
        drop(first);
        let result: Result<(), &str> = (|| {
            let _guard = lock.acquire().unwrap();
            Err("simulated error")
        })();
        assert!(result.is_err());
        assert!(lock.acquire().is_ok());
    }

    #[test]
    fn audit_lock_releases_during_unwind() {
        let lock = AuditLock::new();
        let result = std::panic::catch_unwind(|| {
            let _guard = lock.acquire().unwrap();
            panic!("simulated failure");
        });
        assert!(result.is_err());
        assert!(lock.acquire().is_ok());
    }

    #[test]
    fn audit_lock_blocks_another_thread_until_worker_finishes() {
        let lock = AuditLock::new();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let (finish_tx, finish_rx) = std::sync::mpsc::channel();
        std::thread::scope(|scope| {
            let worker_lock = &lock;
            scope.spawn(move || {
                let _guard = worker_lock.acquire().unwrap();
                ready_tx.send(()).unwrap();
                finish_rx.recv().unwrap();
            });
            ready_rx.recv().unwrap();
            assert!(lock.acquire().is_err());
            finish_tx.send(()).unwrap();
        });
        assert!(lock.acquire().is_ok());
    }

    #[test]
    fn audit_file_lock_is_cross_process() {
        const CHILD_DIR: &str = "UXPROOF_TEST_LOCK_DIR";
        const CHILD_EXPECT: &str = "UXPROOF_TEST_LOCK_EXPECT";
        if let Some(dir) = std::env::var_os(CHILD_DIR) {
            let locked = lock_audit_file(Path::new(&dir)).is_ok();
            assert_eq!(locked, std::env::var(CHILD_EXPECT).unwrap() == "available");
            return;
        }
        let dir = std::env::temp_dir().join(format!("uxproof-lock-test-{}", Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let held = lock_audit_file(&dir).unwrap();
        let child = |expect| {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "tests::audit_file_lock_is_cross_process"])
                .env(CHILD_DIR, &dir).env(CHILD_EXPECT, expect).output().unwrap();
            output.status.success() && String::from_utf8_lossy(&output.stdout).contains("1 passed")
        };
        assert!(child("busy"));
        drop(held);
        assert!(child("available"));
        let _ = fs::remove_file(dir.join(".audit.lock"));
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn legacy_input_files_are_removed_without_touching_reports() {
        let dir = std::env::temp_dir().join(format!("uxproof-input-cleanup-{}", Uuid::new_v4()));
        let run = dir.join("old-run");
        fs::create_dir_all(&run).unwrap();
        fs::write(run.join("input.json"), b"{\"secret\":true}").unwrap();
        fs::write(run.join("report.json"), b"{}").unwrap();
        remove_legacy_input_files(&dir);
        assert!(!run.join("input.json").exists());
        assert!(run.join("report.json").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
