// Node sidecar plumbing: runtime selection, bounded child process lifetime,
// tree kill and the pid registry used by the Stop command.
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

pub(crate) static CHILD_PID: Mutex<Option<u32>> = Mutex::new(None);

// Tauri resolves resources through a canonicalised Windows path, which can carry
// the "\\?\" verbatim prefix. Node's module loader cannot resolve that form
// (it fails with `EISDIR: lstat 'D:'`), so every path handed to Node is stripped
// back to the plain form first.
pub(crate) fn plain_path(path: &Path) -> PathBuf {
    let raw = path.to_string_lossy();
    for prefix in [r"\\?\UNC\", r"\\?\", r"\\.\"] {
        if let Some(rest) = raw.strip_prefix(prefix) {
            let rest = if prefix == r"\\?\UNC\" {
                format!(r"\\{rest}")
            } else {
                rest.to_string()
            };
            return PathBuf::from(rest);
        }
    }
    path.to_path_buf()
}

pub(crate) fn process_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(windows)]
    {
        Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
            .output()
            .map(|output| String::from_utf8_lossy(&output.stdout).contains(&format!("\"{pid}\"")))
            .unwrap_or(true)
    }
    #[cfg(not(windows))]
    {
        Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|status| status.success())
            .unwrap_or(true)
    }
}

pub(crate) fn kill_pid(pid: u32) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).output();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).output();
    }
}

pub(crate) fn kill_running_audit() {
    if let Ok(guard) = CHILD_PID.lock() {
        if let Some(pid) = *guard {
            kill_pid(pid);
        }
    }
}

// BUG-028: TerminateProcess on UXProof.exe does not run Drop or Tauri Exit.
// A Windows job with KILL_ON_JOB_CLOSE is closed by the kernel when the parent
// handle table dies, so Node and Chromium go with it.
#[cfg(windows)]
mod job {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    pub(super) struct KillOnCloseJob(HANDLE);

    impl Drop for KillOnCloseJob {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0); }
        }
    }

    pub(super) fn attach(child: &Child) -> Option<KillOnCloseJob> {
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return None;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let sized = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                std::ptr::from_ref(&info).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            let process = child.as_raw_handle() as HANDLE;
            if sized == 0 || AssignProcessToJobObject(job, process) == 0 {
                CloseHandle(job);
                return None;
            }
            Some(KillOnCloseJob(job))
        }
    }
}

fn kill_tree(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill").args(["/PID", &child.id().to_string(), "/T", "/F"]).output();
    }
    #[cfg(not(windows))]
    {
        let _ = child.kill();
    }
    let _ = child.wait();
}

pub(crate) fn select_runner(dev: &Path, bundled: &Path, allow_dev: bool) -> Result<PathBuf, String> {
    if allow_dev && dev.is_file() { return Ok(plain_path(dev)); }
    if bundled.is_file() { return Ok(plain_path(bundled)); }
    Err("Не найден runner/cli.mjs. Проверьте ресурсы сборки.".into())
}

pub(crate) fn select_runtime(resource_dir: &Path, allow_dev: bool) -> Result<(PathBuf, Option<PathBuf>), String> {
    if allow_dev || !cfg!(windows) { return Ok((PathBuf::from("node"), None)); }
    let runtime = plain_path(&resource_dir.join("runtime"));
    let node = runtime.join("node.exe");
    let browsers = runtime.join("playwright");
    if !node.is_file() || !browsers.is_dir() {
        return Err("В установке отсутствует встроенный Node.js или Chromium. Переустановите приложение.".into());
    }
    Ok((node, Some(browsers)))
}

pub(crate) fn run_node(script: &Path, input: &[u8], node: &Path, browsers: Option<&Path>, runs_dir: Option<&Path>) -> Result<Vec<u8>, String> {
    let mut command = Command::new(node);
    if let Some(browser_dir) = browsers {
        command.env("PLAYWRIGHT_BROWSERS_PATH", browser_dir).env_remove("NODE_OPTIONS");
    }
    // The CLI acquires its lock in the same directory as this process, unless the
    // desktop app already holds it for the whole IPC call.
    if let Some(dir) = runs_dir {
        command.env("UXPROOF_RUNS_DIR", plain_path(dir));
    }
    command.env("UXPROOF_LOCK_HELD", "1");
    let mut child = command.arg(plain_path(script))
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Не удалось запустить Node.js: {e}"))?;
    #[cfg(windows)]
    let _job = job::attach(&child);
    *CHILD_PID.lock().map_err(|e| e.to_string())? = Some(child.id());
    struct ClearPid;
    impl Drop for ClearPid {
        fn drop(&mut self) {
            if let Ok(mut pid) = CHILD_PID.lock() {
                *pid = None;
            }
        }
    }
    let _clear_pid = ClearPid;
    let mut stdin = child.stdin.take().ok_or("Нет stdin у процесса Node.js")?;
    let input = input.to_vec();
    let in_handle = thread::spawn(move || stdin.write_all(&input));
    let mut stdout = child.stdout.take().ok_or("Нет stdout у процесса Node.js")?;
    let mut stderr = child.stderr.take().ok_or("Нет stderr у процесса Node.js")?;
    let out_handle = thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });
    let err_handle = thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf);
        buf
    });
    let requested = std::env::var("UXPROOF_MAX_MS").ok().and_then(|value| value.parse::<u64>().ok()).unwrap_or(12 * 60 * 1000);
    let limit = Duration::from_millis(requested.saturating_add(30_000));
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() > limit => {
                kill_tree(&mut child);
                let _ = join_node_io(in_handle, out_handle, err_handle);
                return Err("Проверка превысила лимит времени и была остановлена".into());
            }
            Ok(None) => thread::sleep(Duration::from_millis(200)),
            Err(error) => {
                kill_tree(&mut child);
                let _ = join_node_io(in_handle, out_handle, err_handle);
                return Err(error.to_string());
            }
        }
    };
    let (stdout_buf, stderr_buf, input_result) = join_node_io(in_handle, out_handle, err_handle)?;
    if !status.success() {
        let stderr = String::from_utf8_lossy(&stderr_buf);
        return Err(format!("Проверка завершилась с ошибкой: {}", stderr.chars().take(1500).collect::<String>()));
    }
    input_result.map_err(|e| format!("Не удалось передать данные runner: {e}"))?;
    Ok(stdout_buf)
}

fn join_node_io(
    in_handle: thread::JoinHandle<std::io::Result<()>>,
    out_handle: thread::JoinHandle<Vec<u8>>,
    err_handle: thread::JoinHandle<Vec<u8>>,
) -> Result<(Vec<u8>, Vec<u8>, std::io::Result<()>), String> {
    let stdout_buf = out_handle.join().map_err(|_| "Не удалось прочитать stdout".to_string())?;
    let stderr_buf = err_handle.join().map_err(|_| "Не удалось прочитать stderr".to_string())?;
    let input_result = in_handle.join().map_err(|_| "Не удалось передать данные runner".to_string())?;
    Ok((stdout_buf, stderr_buf, input_result))
}

pub(crate) fn reveal(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("explorer").arg(path).spawn().map_err(|e| format!("Не удалось открыть отчёт: {e}"))?;
    }
    #[cfg(not(windows))]
    {
        Command::new("xdg-open").arg(path).spawn().map_err(|e| format!("Не удалось открыть отчёт: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn run_node_returns_after_a_hung_process() {
        let dir = std::env::temp_dir().join(format!("uxproof-hang-test-{}", Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let script = dir.join("hang.mjs");
        std::fs::write(&script, "setInterval(() => {}, 1000);\n").unwrap();
        let previous = std::env::var("UXPROOF_MAX_MS").ok();
        std::env::set_var("UXPROOF_MAX_MS", "1");
        let started = Instant::now();
        let error = run_node(&script, b"{}", Path::new("node"), None, None).unwrap_err();
        if let Some(value) = previous { std::env::set_var("UXPROOF_MAX_MS", value); } else { std::env::remove_var("UXPROOF_MAX_MS"); }
        assert!(error.contains("лимит времени"), "{error}");
        assert!(started.elapsed() < Duration::from_secs(45), "hung node was not joined in time");
        std::fs::remove_file(script).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn runner_receives_config_through_stdin() {
        let dir = std::env::temp_dir().join(format!("uxproof-stdin-test-{}", Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let script = dir.join("runner.mjs");
        std::fs::write(&script, "let s=''; for await (const c of process.stdin) s += c; process.stdout.write(JSON.parse(s).probe);").unwrap();
        let output = run_node(&script, br#"{"probe":"received"}"#, Path::new("node"), None, None).unwrap();
        assert_eq!(output, b"received");
        std::fs::remove_file(script).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn verbatim_windows_prefixes_are_stripped_before_node() {
        // Tauri resolves the resource dir to "\\?\D:\..." and Node's loader cannot
        // resolve that form (it fails with `EISDIR: lstat 'D:'`).
        if cfg!(windows) {
            assert_eq!(plain_path(Path::new(r"\\?\D:\Proj\runner\cli.mjs")), PathBuf::from(r"D:\Proj\runner\cli.mjs"));
            assert_eq!(plain_path(Path::new(r"\\?\UNC\srv\share\cli.mjs")), PathBuf::from(r"\\srv\share\cli.mjs"));
        }
        assert_eq!(plain_path(Path::new("node")), PathBuf::from("node"));
        assert_eq!(plain_path(Path::new("relative/cli.mjs")), PathBuf::from("relative/cli.mjs"));
    }

    #[test]
    fn release_requires_packaged_runtime_and_dev_uses_system_node() {
        let dir = std::env::temp_dir().join(format!("uxproof-runtime-test-{}", Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        assert!(select_runtime(&dir, false).is_err());
        assert_eq!(select_runtime(&dir, true).unwrap(), (PathBuf::from("node"), None));
        let runtime = dir.join("runtime");
        let browsers = runtime.join("playwright");
        std::fs::create_dir_all(&browsers).unwrap();
        std::fs::write(runtime.join("node.exe"), b"fixture").unwrap();
        assert_eq!(select_runtime(&dir, false).unwrap(), (runtime.join("node.exe"), Some(browsers.clone())));
        std::fs::remove_file(runtime.join("node.exe")).unwrap();
        std::fs::remove_dir(browsers).unwrap();
        std::fs::remove_dir(runtime).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn release_selects_bundled_runner_even_if_source_checkout_exists() {
        let dir = std::env::temp_dir().join(format!("uxproof-runner-test-{}", Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let dev = dir.join("dev.mjs");
        let bundled = dir.join("bundle.mjs");
        std::fs::write(&dev, "dev").unwrap();
        std::fs::write(&bundled, "bundle").unwrap();
        assert_eq!(select_runner(&dev, &bundled, false).unwrap(), bundled);
        assert_eq!(select_runner(&dev, &bundled, true).unwrap(), dev);
        std::fs::remove_file(&bundled).unwrap();
        assert!(select_runner(&dev, &bundled, false).is_err());
        std::fs::remove_file(&dev).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn closing_the_job_kills_node_and_its_child() {
        use std::sync::mpsc;
        let mut child = Command::new("node")
            .args(["-e", "const {spawn}=require('child_process'); const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); process.stdout.write(String(g.pid)); setInterval(()=>{},1000);"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let job = job::attach(&child).expect("Windows job object");
        let mut stdout = child.stdout.take().unwrap();
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let mut buf = [0u8; 16];
            let n = stdout.read(&mut buf).unwrap_or(0);
            let _ = tx.send(std::str::from_utf8(&buf[..n]).ok().and_then(|text| text.trim().parse::<u32>().ok()));
        });
        let grandchild = rx.recv_timeout(Duration::from_secs(8)).expect("grandchild pid").expect("parse pid");
        assert!(process_alive(child.id()), "node parent should be running before the job closes");
        assert!(process_alive(grandchild), "node child should be running before the job closes");
        drop(job);
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if !process_alive(child.id()) && !process_alive(grandchild) { break; }
            thread::sleep(Duration::from_millis(50));
        }
        assert!(!process_alive(child.id()), "node parent survived job close");
        assert!(!process_alive(grandchild), "node child survived job close");
        let _ = child.try_wait();
    }

    #[test]
    fn child_pid_is_released_after_success_and_failure() {
        let dir = std::env::temp_dir().join(format!("uxproof-pid-test-{}", Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let ok = dir.join("ok.mjs");
        std::fs::write(&ok, "process.stdout.write('ok');").unwrap();
        assert_eq!(run_node(&ok, b"{}", Path::new("node"), None, None).unwrap(), b"ok");
        assert!(CHILD_PID.lock().unwrap().is_none());
        std::fs::remove_file(ok).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}
