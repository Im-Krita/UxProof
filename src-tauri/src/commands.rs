// IPC commands exposed to the webview. Each one validates its arguments before
// touching the file system or spawning Node.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::Manager;
use uuid::Uuid;

use crate::spawn::{kill_pid, reveal, run_node, select_runner, select_runtime, CHILD_PID};
use crate::url::{inside, parse_http_url, valid_token, validate};
use crate::{lock_audit_file, AUDIT_LOCK};

pub(crate) fn report_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // One runs directory (and one lock) for the desktop app, the CLI and the dev
    // API. UXPROOF_RUNS_DIR wins so all three can be pointed at the same place;
    // a debug build otherwise uses the repository directory used by the CLI.
    let root = match std::env::var("UXPROOF_RUNS_DIR") {
        Ok(value) if !value.trim().is_empty() => PathBuf::from(value),
        _ if cfg!(debug_assertions) => Path::new(env!("CARGO_MANIFEST_DIR")).join("../.uxproof-data/runs"),
        _ => app.path().app_data_dir().map_err(|e| e.to_string())?.join("runs"),
    };
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

fn runner_script(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("../runner/cli.mjs");
    let bundled = app.path().resource_dir().map_err(|e| e.to_string())?.join("runner/cli.mjs");
    select_runner(&dev, &bundled, cfg!(debug_assertions))
}

#[tauri::command]
pub(crate) async fn run_audit(app: tauri::AppHandle, config: Value) -> Result<Value, String> {
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
        // The worker owns the guards so dropping the IPC future cannot unlock a running audit.
        let _guard = guard;
        let _file_guard = file_guard;
        let mut payload = config;
        payload["runId"] = json!(id);
        payload["outputDir"] = json!(dir.to_string_lossy().to_string());
        let input = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
        let stdout = run_node(&script, &input, &node, browsers.as_deref(), Some(&root))?;
        serde_json::from_slice(&stdout).map_err(|e| format!("Некорректный ответ runner: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn cancel_audit() -> Result<String, String> {
    let pid = *CHILD_PID.lock().map_err(|e| e.to_string())?;
    let Some(pid) = pid else {
        return Err("Нет выполняющейся проверки".into());
    };
    kill_pid(pid);
    Ok("Проверка остановлена".into())
}

#[tauri::command]
pub(crate) fn list_reports(app: tauri::AppHandle) -> Result<Value, String> {
    let mut reports = Vec::new();
    let mut skipped = 0usize;
    for entry in fs::read_dir(report_root(&app)?).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path().join("report.json");
        if !path.is_file() {
            continue;
        }
        match fs::read(&path).ok().and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok()) {
            Some(report) => reports.push(report),
            None => skipped += 1,
        }
    }
    reports.sort_by(|a, b| b.get("startedAt").and_then(Value::as_str).cmp(&a.get("startedAt").and_then(Value::as_str)));
    reports.truncate(30);
    Ok(json!({ "reports": reports, "skipped": skipped }))
}

#[tauri::command]
pub(crate) fn read_screenshot(app: tauri::AppHandle, run_id: String, filename: String) -> Result<String, String> {
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
pub(crate) fn export_trace(app: tauri::AppHandle, run_id: String, filename: String) -> Result<String, String> {
    if !valid_token(&run_id) || !valid_token(&filename) || !filename.ends_with(".zip") {
        return Err("Недопустимое имя файла".into());
    }
    let root = report_root(&app)?;
    let path = root.join(&run_id).join("traces").join(&filename);
    if !path.is_file() {
        return Err("Trace-файл отсутствует".into());
    }
    inside(&root, &path)?;
    reveal(&path)?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub(crate) async fn plan_steps(app: tauri::AppHandle, goal: String, base_url: String, provider: String) -> Result<Value, String> {
    if goal.trim().is_empty() || goal.len() > 1000 {
        return Err("Опишите цель проверки".into());
    }
    let base = parse_http_url(&base_url)?;
    let provider = if provider == "ollama" { "ollama" } else { "openai" };
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("../runner/planner-cli.mjs");
    let bundled = app.path().resource_dir().map_err(|e| e.to_string())?.join("runner/planner-cli.mjs");
    let script = if cfg!(debug_assertions) && dev.is_file() { dev } else { bundled };
    if !script.is_file() {
        return Err("Не найден runner/planner-cli.mjs. Проверьте ресурсы сборки.".into());
    }
    let (node, browsers) = select_runtime(&app.path().resource_dir().map_err(|e| e.to_string())?, cfg!(debug_assertions))?;
    let payload = serde_json::to_vec(&json!({ "goal": goal, "baseUrl": base.as_str(), "provider": provider }))
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let stdout = run_node(&script, &payload, &node, browsers.as_deref(), None)?;
        serde_json::from_slice::<Value>(&stdout).map_err(|e| format!("Некорректный ответ планировщика: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn export_xlsx(app: tauri::AppHandle, run_id: String) -> Result<String, String> {
    if !valid_token(&run_id) {
        return Err("Недопустимый ID".into());
    }
    let root = report_root(&app)?;
    let path = root.join(&run_id).join("report.xlsx");
    if !path.is_file() {
        return Err("Excel-отчёт отсутствует".into());
    }
    inside(&root, &path)?;
    reveal(&path)?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub(crate) fn export_html(app: tauri::AppHandle, run_id: String) -> Result<String, String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_without_a_run_reports_idle() {
        if CHILD_PID.lock().unwrap().is_none() {
            assert!(cancel_audit().is_err());
        }
    }
}
