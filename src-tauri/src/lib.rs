use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use serde::Deserialize;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    net::Ipv4Addr,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;
use url::Url;
use uuid::Uuid;

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

static AUDIT_LOCK: AuditLock = AuditLock::new();
static CHILD_PID: Mutex<Option<u32>> = Mutex::new(None);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigLimits {
    min_scenarios: usize,
    max_scenarios: usize,
    min_steps: usize,
    max_steps: usize,
    min_viewports: usize,
    max_viewports: usize,
    min_width: u64,
    max_width: u64,
    min_height: u64,
    max_height: u64,
    max_project_len: usize,
    max_scenario_title: usize,
    max_step_name: usize,
    max_target: usize,
    max_value: usize,
    step_types: Vec<String>,
}

fn config_limits() -> ConfigLimits {
    serde_json::from_str(include_str!("../../runner/schemas/audit-config-limits.json"))
        .expect("audit-config-limits.json")
}

fn process_alive(pid: u32) -> bool {
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

struct FileLock {
    file: Option<File>,
    path: PathBuf,
}

impl Drop for FileLock {
    fn drop(&mut self) {
        self.file.take();
        let _ = fs::remove_file(&self.path);
    }
}

fn lock_audit_file(root: &Path) -> Result<FileLock, String> {
    let path = root.join(".audit.lock");
    let mut file = OpenOptions::new().read(true).write(true).create(true).open(&path)
        .map_err(|e| format!("Не удалось открыть блокировку проверки: {e}"))?;
    file.try_lock().map_err(|e| format!("Не удалось получить блокировку проверки: {e}"))?;
    file.seek(SeekFrom::Start(0)).map_err(|e| format!("Не удалось прочитать блокировку проверки: {e}"))?;
    let mut existing = String::new();
    file.read_to_string(&mut existing).map_err(|e| format!("Не удалось прочитать блокировку проверки: {e}"))?;
    let owner: u32 = existing.trim().parse().unwrap_or(0);
    if owner != 0 && owner != std::process::id() && process_alive(owner) {
        return Err("Уже выполняется другая проверка. Дождитесь её завершения.".into());
    }
    file.set_len(0).map_err(|e| format!("Не удалось записать блокировку проверки: {e}"))?;
    file.seek(SeekFrom::Start(0)).map_err(|e| format!("Не удалось записать блокировку проверки: {e}"))?;
    write!(&file, "{}", std::process::id()).map_err(|e| format!("Не удалось записать блокировку проверки: {e}"))?;
    file.flush().map_err(|e| format!("Не удалось записать блокировку проверки: {e}"))?;
    Ok(FileLock { file: Some(file), path })
}

fn kill_pid(pid: u32) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).output();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).output();
    }
}

fn report_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?.join("runs");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

fn select_runner(dev: &Path, bundled: &Path, allow_dev: bool) -> Result<PathBuf, String> {
    if allow_dev && dev.is_file() { return Ok(dev.to_path_buf()); }
    if bundled.is_file() { return Ok(bundled.to_path_buf()); }
    Err("Не найден runner/cli.mjs. Проверьте ресурсы сборки.".into())
}

fn runner_script(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("../runner/cli.mjs");
    let bundled = app.path().resource_dir().map_err(|e| e.to_string())?.join("runner/cli.mjs");
    select_runner(&dev, &bundled, cfg!(debug_assertions))
}

fn valid_token(input: &str) -> bool {
    !input.is_empty()
        && input.len() <= 128
        && !input.contains("..")
        && input != "."
        && input.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_' || c == b'.')
}

fn blocked_host(host: &str) -> bool {
    let host = host.trim_matches(|c| c == '[' || c == ']').trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty()
        || host == "0.0.0.0"
        || host == "::"
        || host == "metadata.google.internal"
        || host == "metadata.goog"
        || host == "metadata.internal"
    {
        return true;
    }
    if let Ok(ip) = host.parse::<Ipv4Addr>() {
        let [a, b, _, _] = ip.octets();
        return (a == 169 && b == 254) || ip.is_unspecified() || ip.is_multicast();
    }
    if let Ok(ip) = host.parse::<std::net::Ipv6Addr>() {
        if let Some(mapped) = ip.to_ipv4_mapped() {
            return blocked_host(&mapped.to_string());
        }
        let parts = ip.segments();
        if parts[0] == 0x64 && parts[1] == 0xff9b && parts[2..6].iter().all(|part| *part == 0) {
            let embedded = Ipv4Addr::new((parts[6] >> 8) as u8, parts[6] as u8, (parts[7] >> 8) as u8, parts[7] as u8);
            return blocked_host(&embedded.to_string());
        }
        let link_local = ip.segments()[0] & 0xffc0 == 0xfe80;
        return ip.is_unspecified() || ip.is_multicast() || link_local;
    }
    false
}

fn parse_http_url(raw: &str) -> Result<Url, String> {
    if raw.len() > 2048 {
        return Err("Слишком длинный URL".into());
    }
    let url = Url::parse(raw).map_err(|_| "Укажите корректный URL".to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Поддерживается только http(s) URL".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Укажите http(s) URL без учетных данных".into());
    }
    let host = url.host_str().unwrap_or("");
    if blocked_host(host) {
        return Err("Служебный адрес запрещён".into());
    }
    Ok(url)
}

fn check_navigate(base: &Url, value: &str) -> Result<(), String> {
    let value = value.trim();
    if value.len() > 2000 {
        return Err("Слишком длинное значение шага".into());
    }
    let scheme = value.split(':').next().unwrap_or("");
    if value.contains(':')
        && !value.starts_with('/')
        && !value.starts_with('.')
        && !value.starts_with('?')
        && scheme.chars().all(|c| c.is_ascii_alphabetic())
        && !value.starts_with("http://")
        && !value.starts_with("https://")
    {
        return Err("Переход разрешён только по http(s)".into());
    }
    if value.contains("://") || value.starts_with("//") {
        let target = if let Some(rest) = value.strip_prefix("//") {
            Url::parse(&format!("{}://{rest}", base.scheme())).map_err(|_| "Некорректный адрес перехода".to_string())?
        } else {
            Url::parse(value).map_err(|_| "Некорректный адрес перехода".to_string())?
        };
        if target.scheme() != base.scheme()
            || target.host_str() != base.host_str()
            || target.port_or_known_default() != base.port_or_known_default()
        {
            return Err("Переход за пределы адреса проекта запрещён".into());
        }
        if blocked_host(target.host_str().unwrap_or("")) {
            return Err("Служебный адрес запрещён".into());
        }
    }
    Ok(())
}

fn validate(config: &Value) -> Result<(), String> {
    let limits = config_limits();
    let raw_url = config.get("baseUrl").and_then(Value::as_str).ok_or("Укажите URL проекта")?;
    let base = parse_http_url(raw_url)?;
    if let Some(project) = config.get("project").and_then(Value::as_str) {
        if project.len() > limits.max_project_len {
            return Err("Слишком длинное название проекта".into());
        }
    }
    let scenarios = config.get("scenarios").and_then(Value::as_array).ok_or("Нет сценариев")?;
    let viewports = config.get("viewports").and_then(Value::as_array).ok_or("Нет размеров экранов")?;
    if scenarios.len() < limits.min_scenarios || scenarios.len() > limits.max_scenarios || viewports.len() < limits.min_viewports || viewports.len() > limits.max_viewports {
        return Err("Допускается 1–10 сценариев и 1–4 размера экранов".into());
    }
    for scenario in scenarios {
        if scenario.get("title").and_then(Value::as_str).unwrap_or("").len() > limits.max_scenario_title {
            return Err("Слишком длинное название сценария".into());
        }
        let steps = scenario.get("steps").and_then(Value::as_array).ok_or("У сценария нет шагов")?;
        if steps.len() < limits.min_steps || steps.len() > limits.max_steps {
            return Err("В сценарии должно быть 1–30 шагов".into());
        }
        for step in steps {
            let kind = step.get("type").and_then(Value::as_str).unwrap_or("");
            if !limits.step_types.iter().any(|item| item == kind) {
                return Err(format!("Недопустимая операция: {kind}"));
            }
            if step.get("name").and_then(Value::as_str).unwrap_or("").len() > limits.max_step_name {
                return Err("Слишком длинное название шага".into());
            }
            let target = step.get("target").and_then(Value::as_str).unwrap_or("");
            if target.len() > limits.max_target {
                return Err("Слишком длинный селектор".into());
            }
            if kind != "wait" && kind != "navigate" && target.trim().is_empty() {
                return Err("У шага отсутствует селектор".into());
            }
            let value = step.get("value").and_then(Value::as_str).unwrap_or("");
            if value.len() > limits.max_value {
                return Err("Слишком длинное значение шага".into());
            }
            if matches!(kind, "expectText" | "expectValue" | "select") && value.trim().is_empty() {
                return Err("У шага отсутствует ожидаемое значение".into());
            }
            if kind == "navigate" {
                check_navigate(&base, value)?;
            }
        }
    }
    for viewport in viewports {
        let width = viewport.get("width").and_then(Value::as_u64).unwrap_or(0);
        let height = viewport.get("height").and_then(Value::as_u64).unwrap_or(0);
        if !(limits.min_width..=limits.max_width).contains(&width) || !(limits.min_height..=limits.max_height).contains(&height) {
            return Err("Недопустимый размер экрана".into());
        }
    }
    Ok(())
}

fn inside(root: &Path, target: &Path) -> Result<(), String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let target = target.canonicalize().map_err(|e| e.to_string())?;
    if target.starts_with(&root) {
        Ok(())
    } else {
        Err("Путь выходит за каталог отчёта".into())
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

fn select_runtime(resource_dir: &Path, allow_dev: bool) -> Result<(PathBuf, Option<PathBuf>), String> {
    if allow_dev || !cfg!(windows) { return Ok((PathBuf::from("node"), None)); }
    let runtime = resource_dir.join("runtime");
    let node = runtime.join("node.exe");
    let browsers = runtime.join("playwright");
    if !node.is_file() || !browsers.is_dir() {
        return Err("В установке отсутствует встроенный Node.js или Chromium. Переустановите приложение.".into());
    }
    Ok((node, Some(browsers)))
}

fn run_node(script: &Path, input: &[u8], node: &Path, browsers: Option<&Path>) -> Result<Vec<u8>, String> {
    let mut command = Command::new(node);
    if let Some(browser_dir) = browsers {
        command.env("PLAYWRIGHT_BROWSERS_PATH", browser_dir).env_remove("NODE_OPTIONS");
    }
    let mut child = command.arg(script)
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Не удалось запустить Node.js: {e}"))?;
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

fn reveal(path: &Path) -> Result<(), String> {
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

#[tauri::command]
async fn run_audit(app: tauri::AppHandle, config: Value) -> Result<Value, String> {
    validate(&config)?;
    let guard = AUDIT_LOCK.acquire()?;
    let root = report_root(&app)?;
    let file_guard = lock_audit_file(&root)?;
    let id = Uuid::new_v4().to_string();
    let dir = root.join(&id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let script = runner_script(&app)?;
    let (node, browsers) = select_runtime(&app.path().resource_dir().map_err(|e| e.to_string())?, cfg!(debug_assertions))?;
    tauri::async_runtime::spawn_blocking(move || {
        // The worker owns the guard so cancellation of the IPC future cannot unlock a running audit.
        let _guard = guard;
        let _file_guard = file_guard;
        let mut payload = config;
        payload["runId"] = json!(id);
        payload["outputDir"] = json!(dir.to_string_lossy().to_string());
        let input = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
        let stdout = run_node(&script, &input, &node, browsers.as_deref())?;
        serde_json::from_slice(&stdout).map_err(|e| format!("Некорректный ответ runner: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn cancel_audit() -> Result<String, String> {
    let pid = *CHILD_PID.lock().map_err(|e| e.to_string())?;
    let Some(pid) = pid else {
        return Err("Нет выполняющейся проверки".into());
    };
    kill_pid(pid);
    Ok("Проверка остановлена".into())
}

#[tauri::command]
fn list_reports(app: tauri::AppHandle) -> Result<Vec<Value>, String> {
    let mut reports = Vec::new();
    for entry in fs::read_dir(report_root(&app)?).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path().join("report.json");
        if !path.is_file() {
            continue;
        }
        if let Ok(bytes) = fs::read(&path) {
            if let Ok(report) = serde_json::from_slice::<Value>(&bytes) {
                reports.push(report);
            }
        }
    }
    reports.sort_by(|a, b| b.get("startedAt").and_then(Value::as_str).cmp(&a.get("startedAt").and_then(Value::as_str)));
    reports.truncate(30);
    Ok(reports)
}

#[tauri::command]
fn read_screenshot(app: tauri::AppHandle, run_id: String, filename: String) -> Result<String, String> {
    if !valid_token(&run_id) || !valid_token(&filename) || !filename.ends_with(".png") {
        return Err("Недопустимое имя файла".into());
    }
    let root = report_root(&app)?;
    let path = root.join(&run_id).join("screenshots").join(&filename);
    inside(&root, &path)?;
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("Скриншот слишком большой".into());
    }
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

#[tauri::command]
fn export_html(app: tauri::AppHandle, run_id: String) -> Result<String, String> {
    if !valid_token(&run_id) {
        return Err("Недопустимый ID".into());
    }
    let root = report_root(&app)?;
    let path = root.join(&run_id).join("report.html");
    if !path.is_file() {
        return Err("HTML-отчет отсутствует".into());
    }
    inside(&root, &path)?;
    reveal(&path)?;
    Ok(path.display().to_string())
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![run_audit, cancel_audit, list_reports, read_screenshot, export_html])
        .run(tauri::generate_context!())
        .expect("error running UXProof");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn config() -> Value {
        json!({
            "project": "Relay",
            "baseUrl": "http://127.0.0.1:4180",
            "scenarios": [{"title": "demo", "steps": [{"type": "click", "name": "Открыть", "target": "css:#save", "value": ""}]}],
            "viewports": [{"id": "mobile", "label": "Mobile", "width": 390, "height": 844}]
        })
    }

    #[test]
    fn accepts_local_demo() {
        assert!(validate(&config()).is_ok());
    }

    #[test]
    fn limits_file_drives_validation() {
        let limits = config_limits();
        assert_eq!(limits.max_scenarios, 10);
        assert_eq!(limits.max_steps, 30);
        assert_eq!(limits.max_viewports, 4);
        assert!(cancel_audit().is_err());
    }

    #[test]
    fn rejects_file_url_and_metadata() {
        let mut file_url = config();
        file_url["baseUrl"] = json!("file:///C:/Windows/win.ini");
        assert!(validate(&file_url).is_err());
        let mut metadata = config();
        metadata["baseUrl"] = json!("http://169.254.169.254/latest/meta-data");
        assert!(validate(&metadata).is_err());
        let mut credentials = config();
        credentials["baseUrl"] = json!("http://user:secret@127.0.0.1:4180");
        assert!(validate(&credentials).is_err());
        let mut mapped_metadata = config();
        mapped_metadata["baseUrl"] = json!("http://[::ffff:169.254.169.254]/");
        assert!(validate(&mapped_metadata).is_err());
        let mut nat64_metadata = config();
        nat64_metadata["baseUrl"] = json!("http://[64:ff9b::a9fe:a9fe]/");
        assert!(validate(&nat64_metadata).is_err());
    }

    #[test]
    fn rejects_script_steps_and_cross_origin_navigation() {
        let mut eval_step = config();
        eval_step["scenarios"][0]["steps"][0]["type"] = json!("eval");
        assert!(validate(&eval_step).is_err());
        let mut hop = config();
        hop["scenarios"][0]["steps"][0] = json!({"type": "navigate", "name": "Уйти", "target": "", "value": "https://example.com"});
        assert!(validate(&hop).is_err());
        let mut script = config();
        script["scenarios"][0]["steps"][0] = json!({"type": "navigate", "name": "Скрипт", "target": "", "value": "javascript:alert(1)"});
        assert!(validate(&script).is_err());
    }

    #[test]
    fn rejects_path_tokens() {
        assert!(!valid_token(".."));
        assert!(!valid_token("../secret.png"));
        assert!(valid_token("1-1-server-desktop.png"));
    }

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
            let output = Command::new(std::env::current_exe().unwrap())
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
    fn run_node_returns_after_a_hung_process() {
        let dir = std::env::temp_dir().join(format!("uxproof-hang-test-{}", Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let script = dir.join("hang.mjs");
        fs::write(&script, "setInterval(() => {}, 1000);\n").unwrap();
        let previous = std::env::var("UXPROOF_MAX_MS").ok();
        std::env::set_var("UXPROOF_MAX_MS", "1");
        let started = Instant::now();
        let error = run_node(&script, b"{}", Path::new("node"), None).unwrap_err();
        if let Some(value) = previous { std::env::set_var("UXPROOF_MAX_MS", value); } else { std::env::remove_var("UXPROOF_MAX_MS"); }
        assert!(error.contains("лимит времени"), "{error}");
        assert!(started.elapsed() < Duration::from_secs(45), "hung node was not joined in time");
        fs::remove_file(script).unwrap();
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn runner_receives_config_through_stdin() {
        let dir = std::env::temp_dir().join(format!("uxproof-stdin-test-{}", Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let script = dir.join("runner.mjs");
        fs::write(&script, "let s=''; for await (const c of process.stdin) s += c; process.stdout.write(JSON.parse(s).probe);").unwrap();
        let output = run_node(&script, br#"{"probe":"received"}"#, Path::new("node"), None).unwrap();
        assert_eq!(output, b"received");
        fs::remove_file(script).unwrap();
        fs::remove_dir(dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn release_requires_packaged_runtime_and_dev_uses_system_node() {
        let dir = std::env::temp_dir().join(format!("uxproof-runtime-test-{}", Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        assert!(select_runtime(&dir, false).is_err());
        assert_eq!(select_runtime(&dir, true).unwrap(), (PathBuf::from("node"), None));
        let runtime = dir.join("runtime");
        let browsers = runtime.join("playwright");
        fs::create_dir_all(&browsers).unwrap();
        fs::write(runtime.join("node.exe"), b"fixture").unwrap();
        assert_eq!(select_runtime(&dir, false).unwrap(), (runtime.join("node.exe"), Some(browsers.clone())));
        fs::remove_file(runtime.join("node.exe")).unwrap();
        fs::remove_dir(browsers).unwrap();
        fs::remove_dir(runtime).unwrap();
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn release_selects_bundled_runner_even_if_source_checkout_exists() {
        let dir = std::env::temp_dir().join(format!("uxproof-runner-test-{}", Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let dev = dir.join("dev.mjs");
        let bundled = dir.join("bundle.mjs");
        fs::write(&dev, "dev").unwrap();
        fs::write(&bundled, "bundle").unwrap();
        assert_eq!(select_runner(&dev, &bundled, false).unwrap(), bundled);
        assert_eq!(select_runner(&dev, &bundled, true).unwrap(), dev);
        fs::remove_file(&bundled).unwrap();
        assert!(select_runner(&dev, &bundled, false).is_err());
        fs::remove_file(&dev).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}
