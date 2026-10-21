use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{Manager, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Clone, Serialize)]
pub struct BackendStatus {
    pub running: bool,
    pub message: String,
}

struct SidecarProc {
    child: CommandChild,
    spawned_at: Instant,
}

struct SidecarSlot(Mutex<Option<SidecarProc>>);
struct StatusSlot(Mutex<BackendStatus>);
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

fn offline(error: impl ToString) -> BackendStatus {
    BackendStatus {
        running: false,
        message: format!("backend offline, fixture ({})", error.to_string()),
    }
}

fn sidecar_command(app: &tauri::AppHandle) -> Result<tauri_plugin_shell::process::Command, String> {
    let mut command = app
        .shell()
        .sidecar("tabulect-backend")
        .map_err(|error| error.to_string())?;

    command = command
        .env("TABULECT_HOST", "127.0.0.1")
        .env("TABULECT_PARENT_PID", std::process::id().to_string())
        .env("TABULECT_PORT", "8755");

    if let Ok(dir) = app.path().resource_dir() {
        let candidates = [
            dir.join("sidecar").join("server.mjs"),
            dir.join("_up_").join("sidecar").join("server.mjs"),
            dir.join("resources").join("sidecar").join("server.mjs"),
        ];
        if let Some(server) = candidates.into_iter().find(|path| path.exists()) {
            command = command.env("TABULECT_SERVER", server.to_string_lossy().as_ref());
        }
    }

    Ok(command)
}

fn sidecar_health_online() -> bool {
    curl_health().is_ok()
}

fn pid_alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn attempt_sidecar(app: &tauri::AppHandle) -> BackendStatus {
    if SHUTTING_DOWN.load(Ordering::Relaxed) {
        return offline("application is closing");
    }
    if sidecar_health_online() {
        return BackendStatus {
            running: true,
            message: "backend started on http://127.0.0.1:8755".into(),
        };
    }

    let slot = app.state::<SidecarSlot>();
    {
        let mut guard = slot.0.lock().expect("sidecar mutex");
        if let Some(proc) = guard.as_ref() {
            let booting = proc.spawned_at.elapsed() < Duration::from_secs(8);
            if pid_alive(proc.child.pid()) && booting {
                return BackendStatus {
                    running: true,
                    message: "backend starting on http://127.0.0.1:8755".into(),
                };
            }
        }
        if let Some(dead) = guard.take() {
            let _ = dead.child.kill();
        }
    }

    let command = match sidecar_command(app) {
        Ok(cmd) => cmd,
        Err(error) => return offline(error),
    };

    match command.spawn() {
        Ok((mut rx, child)) => {
            tauri::async_runtime::spawn(async move {
                // Drain sidecar stdout/stderr. Dropping this receiver fills the pipe
                // and can SIGPIPE / stall the Node process mid-fill.
                while rx.recv().await.is_some() {}
            });
            *slot.0.lock().expect("sidecar mutex") = Some(SidecarProc {
                child,
                spawned_at: Instant::now(),
            });
            BackendStatus {
                running: true,
                message: "backend started on http://127.0.0.1:8755".into(),
            }
        }
        Err(error) => offline(error),
    }
}

#[tauri::command]
fn start_backend(app: tauri::AppHandle, status: State<StatusSlot>) -> BackendStatus {
    let next = attempt_sidecar(&app);
    *status.0.lock().expect("status mutex") = next.clone();
    next
}

#[tauri::command]
fn backend_status(status: State<StatusSlot>) -> BackendStatus {
    status.0.lock().expect("status mutex").clone()
}

#[derive(Debug, Clone, Serialize)]
pub struct PickedDocument {
    pub path: String,
    pub name: String,
}


#[derive(Debug, Clone, Serialize)]
pub struct BackendProbe {
    pub online: bool,
    pub message: String,
    pub body: String,
}

fn curl_health() -> Result<String, String> {
    let output = std::process::Command::new("curl")
        .args([
            "-fsS",
            "--max-time",
            "2",
            "http://127.0.0.1:8755/health",
        ])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "health request failed".into()
        } else {
            err
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn wait_for_health(attempts: u32) -> BackendProbe {
    for _ in 0..attempts {
        match curl_health() {
            Ok(body) if body.contains("\"ok\":true") && body.contains("tabulect") => {
                return BackendProbe {
                    online: true,
                    message: "backend online".into(),
                    body,
                };
            }
            Ok(body) => {
                std::thread::sleep(std::time::Duration::from_millis(400));
                let _ = body;
            }
            Err(_) => std::thread::sleep(std::time::Duration::from_millis(400)),
        }
    }
    BackendProbe {
        online: false,
        message: "backend offline".into(),
        body: String::new(),
    }
}

#[tauri::command]
fn probe_backend(app: tauri::AppHandle, status: State<StatusSlot>) -> BackendProbe {
    let started = attempt_sidecar(&app);
    *status.0.lock().expect("status mutex") = started.clone();
    let probe = wait_for_health(25);
    if probe.online {
        *status.0.lock().expect("status mutex") = BackendStatus {
            running: true,
            message: probe.message.clone(),
        };
    }
    probe
}

#[derive(Debug, Clone, Serialize)]
pub struct BackendHttpResponse {
    pub status: u16,
    pub body: String,
}

fn json_error_field(blob: &str) -> Option<String> {
    let start = blob.find('{')?;
    let end = blob.rfind('}')?;
    let parsed: serde_json::Value = serde_json::from_str(&blob[start..=end]).ok()?;
    parsed.get("error")?.as_str().map(|value| value.to_string())
}

fn backend_error_message(stderr: &str, stdout: &str) -> String {
    if let Some(error) = json_error_field(stdout).or_else(|| json_error_field(stderr)) {
        return error;
    }
    if !stderr.is_empty() {
        return stderr.to_string();
    }
    if !stdout.trim().is_empty() {
        return stdout.trim().to_string();
    }
    "request failed".into()
}

fn split_curl_status(stdout: &str) -> (String, u16) {
    let trimmed = stdout.trim_end_matches(['\n', '\r']);
    if let Some(idx) = trimmed.rfind('\n') {
        let code = trimmed[idx + 1..].trim();
        if let Ok(status) = code.parse::<u16>() {
            return (trimmed[..idx].to_string(), status);
        }
    }
    if let Ok(status) = trimmed.trim().parse::<u16>() {
        return (String::new(), status);
    }
    (stdout.to_string(), 200)
}

static SESSION_TOKEN: Mutex<Option<String>> = Mutex::new(None);

/// Fetch (and cache) the sidecar's per-launch session token from GET /session.
fn session_token(refresh: bool) -> Result<String, String> {
    if !refresh {
        if let Some(token) = SESSION_TOKEN.lock().expect("token mutex").clone() {
            return Ok(token);
        }
    }
    let output = std::process::Command::new("curl")
        .args(["-fsS", "--max-time", "5", "http://127.0.0.1:8755/session"])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err("local session unavailable".into());
    }
    let parsed: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
    let token = parsed
        .get("token")
        .and_then(|value| value.as_str())
        .filter(|value| value.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'))
        .ok_or_else(|| "local session unavailable".to_string())?
        .to_string();
    *SESSION_TOKEN.lock().expect("token mutex") = Some(token.clone());
    Ok(token)
}

fn backend_request_once(method: &str, path: &str, body: Option<&String>, token: &str) -> Result<BackendHttpResponse, String> {
    let url = format!("http://127.0.0.1:8755{path}");
    let token_header = format!("X-Tabulect-Token: {token}");
    let mut cmd = std::process::Command::new("curl");
    // No -f: HTTP 4xx/5xx must return the JSON body to JS instead of curl: (22).
    cmd.args([
        "-sS",
        "--max-time",
        "120",
        "-X",
        method,
        "-H",
        &token_header,
        "-w",
        "\n%{http_code}",
        &url,
    ]);
    if let Some(payload) = body {
        cmd.args(["-H", "Content-Type: application/json", "--data-binary", payload]);
    }
    let output = cmd.output().map_err(|error| error.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        return Err(backend_error_message(&stderr, &stdout));
    }
    let (body_text, status) = split_curl_status(&stdout);
    Ok(BackendHttpResponse {
        status,
        body: body_text,
    })
}

#[tauri::command]
fn backend_request(method: String, path: String, body: Option<String>) -> Result<BackendHttpResponse, String> {
    if !path.starts_with('/') {
        return Err("path must start with /".into());
    }
    let token = session_token(false)?;
    let first = backend_request_once(&method, &path, body.as_ref(), &token)?;
    if first.status == 401 {
        // The sidecar restarted with a new token.
        let fresh = session_token(true)?;
        return backend_request_once(&method, &path, body.as_ref(), &fresh);
    }
    Ok(first)
}


#[tauri::command]
fn wait_ingest(job_id: String) -> Result<String, String> {
    if job_id.trim().is_empty() || job_id.contains('/') || job_id.contains("..") {
        return Err("invalid job id".into());
    }
    let url = format!("http://127.0.0.1:8755/ingest/{job_id}/events");
    let token_header = format!("X-Tabulect-Token: {}", session_token(false)?);
    let output = std::process::Command::new("curl")
        .args(["-NsS", "--max-time", "86400", "-H", &token_header, &url])
        .output()
        .map_err(|error| error.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if stdout.trim().is_empty() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "ingest stream empty".into()
        } else {
            err
        });
    }
    Ok(stdout)
}

#[tauri::command]
fn pick_document() -> Result<Option<PickedDocument>, String> {
    let picked = rfd::FileDialog::new()
        .set_title("Tabulect")
        .add_filter(
            "Tabulect",
            &["pdf", "epub", "html", "htm", "md", "markdown", "docx"],
        )
        .pick_file();
    Ok(picked.map(|path: PathBuf| PickedDocument {
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("document")
            .to_string(),
        path: path.to_string_lossy().to_string(),
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            app.manage(SidecarSlot(Mutex::new(None)));
            app.manage(StatusSlot(Mutex::new(BackendStatus {
                running: false,
                message: "backend offline, fixture".into(),
            })));
            let handle = app.handle().clone();
            let next = attempt_sidecar(&handle);
            *app.state::<StatusSlot>().0.lock().expect("status mutex") = next;
            std::thread::Builder::new()
                .name("tabular-sidecar".into())
                .spawn(move || loop {
                    std::thread::sleep(Duration::from_secs(2));
                    let status = attempt_sidecar(&handle);
                    *handle.state::<StatusSlot>().0.lock().expect("status mutex") = status;
                })
                .ok();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_backend,
            backend_status,
            probe_backend,
            backend_request,
            wait_ingest,
            pick_document
        ])
        .build(tauri::generate_context!())
        .expect("error while building Tabulect")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                SHUTTING_DOWN.store(true, Ordering::Relaxed);
                // Let Node close its persistent AI connections before the shell
                // plugin force-kills the sidecar on Exit.
                let slot = app.state::<SidecarSlot>();
                let pid = slot.0.lock().expect("sidecar mutex").as_ref().map(|proc| proc.child.pid());
                if let Some(pid) = pid {
                    let _ = std::process::Command::new("kill")
                        .args(["-TERM", &pid.to_string()])
                        .status();
                    std::thread::sleep(Duration::from_millis(1800));
                }
            }
        });
}
