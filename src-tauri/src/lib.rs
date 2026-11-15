use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use std::{
    fs::{self, File, OpenOptions},
    io::Read,
    net::Ipv4Addr,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
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

fn lock_audit_file(root: &Path) -> Result<File, String> {
    let file = OpenOptions::new().read(true).write(true).create(true).open(root.join(".audit.lock"))
        .map_err(|e| format!("Не удалось открыть блокировку проверки: {e}"))?;
    file.try_lock().map_err(|e| format!("Не удалось получить блокировку проверки: {e}"))?;
    Ok(file)
}

fn report_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?.join("runs");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

fn runner_script(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("../runner/cli.mjs");
    if dev.is_file() {
        return Ok(dev);
    }
    let bundled = app.path().resource_dir().map_err(|e| e.to_string())?.join("runner/cli.mjs");
    if bundled.is_file() {
        return Ok(bundled);
    }
    Err("Не найден runner/cli.mjs. Проверьте ресурсы сборки.".into())
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
    let raw_url = config.get("baseUrl").and_then(Value::as_str).ok_or("Укажите URL проекта")?;
    let base = parse_http_url(raw_url)?;
    if let Some(project) = config.get("project").and_then(Value::as_str) {
        if project.len() > 200 {
            return Err("Слишком длинное название проекта".into());
        }
    }
    let scenarios = config.get("scenarios").and_then(Value::as_array).ok_or("Нет сценариев")?;
    let viewports = config.get("viewports").and_then(Value::as_array).ok_or("Нет размеров экранов")?;
    if scenarios.is_empty() || scenarios.len() > 10 || viewports.is_empty() || viewports.len() > 4 {
        return Err("Допускается 1–10 сценариев и 1–4 размера экранов".into());
    }
    for scenario in scenarios {
        if scenario.get("title").and_then(Value::as_str).unwrap_or("").len() > 200 {
            return Err("Слишком длинное название сценария".into());
        }
        let steps = scenario.get("steps").and_then(Value::as_array).ok_or("У сценария нет шагов")?;
        if steps.is_empty() || steps.len() > 30 {
            return Err("В сценарии должно быть 1–30 шагов".into());
        }
        for step in steps {
            let kind = step.get("type").and_then(Value::as_str).unwrap_or("");
            if !["click", "fill", "select", "check", "navigate", "expectVisible", "expectHidden", "expectText", "expectValue", "wait"].contains(&kind) {
                return Err(format!("Недопустимая операция: {kind}"));
            }
            if step.get("name").and_then(Value::as_str).unwrap_or("").len() > 200 {
                return Err("Слишком длинное название шага".into());
            }
            let target = step.get("target").and_then(Value::as_str).unwrap_or("");
            if target.len() > 500 {
                return Err("Слишком длинный селектор".into());
            }
            if kind != "wait" && kind != "navigate" && target.trim().is_empty() {
                return Err("У шага отсутствует селектор".into());
            }
            let value = step.get("value").and_then(Value::as_str).unwrap_or("");
            if value.len() > 2000 {
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
        if !(320..=3840).contains(&width) || !(400..=2160).contains(&height) {
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

fn run_node(script: &Path, input: &Path) -> Result<Vec<u8>, String> {
    let mut child = Command::new("node")
        .arg(script)
        .arg(input)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Не удалось запустить Node.js: {e}. Установите Node.js 22+ и выполните npm install в runner/"))?;
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
                return Err("Проверка превысила лимит времени и была остановлена".into());
            }
            Ok(None) => thread::sleep(Duration::from_millis(200)),
            Err(error) => return Err(error.to_string()),
        }
    };
    let stdout_buf = out_handle.join().map_err(|_| "Не удалось прочитать stdout".to_string())?;
    let stderr_buf = err_handle.join().map_err(|_| "Не удалось прочитать stderr".to_string())?;
    if !status.success() {
        let stderr = String::from_utf8_lossy(&stderr_buf);
        return Err(format!("Проверка завершилась с ошибкой: {}", stderr.chars().take(1500).collect::<String>()));
    }
    Ok(stdout_buf)
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
    tauri::async_runtime::spawn_blocking(move || {
        // The worker owns the guard so cancellation of the IPC future cannot unlock a running audit.
        let _guard = guard;
        let _file_guard = file_guard;
        let input = dir.join("input.json");
        let mut payload = config;
        payload["runId"] = json!(id);
        payload["outputDir"] = json!(dir.to_string_lossy().to_string());
        fs::write(&input, serde_json::to_vec(&payload).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        let stdout = run_node(&script, &input)?;
        serde_json::from_slice(&stdout).map_err(|e| format!("Некорректный ответ runner: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
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
        .invoke_handler(tauri::generate_handler![run_audit, list_reports, read_screenshot, export_html])
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
        fs::remove_file(dir.join(".audit.lock")).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}
