// URL and configuration hygiene for the Rust boundary. Everything the webview
// sends arrives here first: the runner repeats the same checks, but a rejected
// configuration must never reach the Node process at all.
use serde::Deserialize;
use serde_json::Value;
use std::{fs, net::Ipv4Addr, path::Path};
use url::Url;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ConfigLimits {
    pub(crate) min_scenarios: usize,
    pub(crate) max_scenarios: usize,
    pub(crate) min_steps: usize,
    pub(crate) max_steps: usize,
    pub(crate) min_viewports: usize,
    pub(crate) max_viewports: usize,
    pub(crate) min_width: u64,
    pub(crate) max_width: u64,
    pub(crate) min_height: u64,
    pub(crate) max_height: u64,
    pub(crate) max_project_len: usize,
    pub(crate) max_scenario_title: usize,
    pub(crate) max_step_name: usize,
    pub(crate) max_target: usize,
    pub(crate) max_value: usize,
    pub(crate) step_types: Vec<String>,
}

pub(crate) fn config_limits() -> ConfigLimits {
    serde_json::from_str(include_str!("../../runner/schemas/audit-config-limits.json"))
        .expect("audit-config-limits.json")
}

pub(crate) fn valid_token(input: &str) -> bool {
    !input.is_empty()
        && input.len() <= 128
        && !input.contains("..")
        && input != "."
        && input.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_' || c == b'.')
}

pub(crate) fn blocked_host(host: &str) -> bool {
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
        let link_local = parts[0] & 0xffc0 == 0xfe80;
        return ip.is_unspecified() || ip.is_multicast() || link_local;
    }
    false
}

pub(crate) fn parse_http_url(raw: &str) -> Result<Url, String> {
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
    if blocked_host(url.host_str().unwrap_or("")) {
        return Err("Служебный адрес запрещён".into());
    }
    Ok(url)
}

pub(crate) fn check_navigate(base: &Url, value: &str) -> Result<(), String> {
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

pub(crate) fn validate(config: &Value) -> Result<(), String> {
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

pub(crate) fn inside(root: &Path, target: &Path) -> Result<(), String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let target = target.canonicalize().map_err(|e| e.to_string())?;
    if target.starts_with(&root) {
        Ok(())
    } else {
        Err("Путь выходит за каталог отчёта".into())
    }
}

pub(crate) fn remove_legacy_input_files(root: &Path) {
    // Old builds wrote the run configuration to input.json; it is never read now.
    let Ok(entries) = fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let stale = entry.path().join("input.json");
        if stale.is_file() {
            let _ = fs::remove_file(&stale);
        }
    }
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
    }

    // Golden check: the struct must consume every key of the schema file, so a new
    // limit cannot be added to JSON while the Rust boundary keeps its old default.
    #[test]
    fn config_limits_match_the_schema_file() {
        let raw: Value = serde_json::from_str(include_str!("../../runner/schemas/audit-config-limits.json")).unwrap();
        let limits = config_limits();
        let object = raw.as_object().expect("limits object");
        assert_eq!(object.len(), 16, "schema gained or lost a key; update ConfigLimits and this test");
        assert_eq!(limits.min_scenarios, object["minScenarios"].as_u64().unwrap() as usize);
        assert_eq!(limits.max_scenarios, object["maxScenarios"].as_u64().unwrap() as usize);
        assert_eq!(limits.min_steps, object["minSteps"].as_u64().unwrap() as usize);
        assert_eq!(limits.max_steps, object["maxSteps"].as_u64().unwrap() as usize);
        assert_eq!(limits.min_viewports, object["minViewports"].as_u64().unwrap() as usize);
        assert_eq!(limits.max_viewports, object["maxViewports"].as_u64().unwrap() as usize);
        assert_eq!(limits.min_width, object["minWidth"].as_u64().unwrap());
        assert_eq!(limits.max_width, object["maxWidth"].as_u64().unwrap());
        assert_eq!(limits.min_height, object["minHeight"].as_u64().unwrap());
        assert_eq!(limits.max_height, object["maxHeight"].as_u64().unwrap());
        assert_eq!(limits.max_project_len, object["maxProjectLen"].as_u64().unwrap() as usize);
        assert_eq!(limits.max_scenario_title, object["maxScenarioTitle"].as_u64().unwrap() as usize);
        assert_eq!(limits.max_step_name, object["maxStepName"].as_u64().unwrap() as usize);
        assert_eq!(limits.max_target, object["maxTarget"].as_u64().unwrap() as usize);
        assert_eq!(limits.max_value, object["maxValue"].as_u64().unwrap() as usize);
        assert_eq!(limits.step_types.len(), object["stepTypes"].as_array().unwrap().len());
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
}
