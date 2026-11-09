// Command Centre — Windows shell.
// Hosts the dashboard UI in a native window, keeps it running in the system tray,
// starts with Windows, and provides three small helpers to the UI:
//   net_request   – HTTP requests without browser CORS limits (calendar link, sign-in)
//   oauth_listen / oauth_wait – temporary local address for Google / Microsoft sign-in
//   open_url      – open links in your default browser, or Zoom/Teams links in their apps
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use std::path::{Component, Path, PathBuf};

use base64::Engine;
use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_notification::NotificationExt;

#[derive(Serialize)]
struct NetResponse {
    status: u16,
    body: String,
}

fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("CommandCentre/1.0")
            .timeout(Duration::from_secs(30))
            .build()
            .expect("http client")
    })
}

#[tauri::command]
async fn net_request(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<NetResponse, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only http(s) URLs are allowed".into());
    }
    let method = reqwest::Method::from_bytes(method.to_uppercase().as_bytes()).map_err(|e| e.to_string())?;
    let mut req = http_client().request(method, &url);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok(NetResponse { status, body })
}

fn listeners() -> &'static Mutex<HashMap<u16, TcpListener>> {
    static L: OnceLock<Mutex<HashMap<u16, TcpListener>>> = OnceLock::new();
    L.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Opens a temporary listener on 127.0.0.1 and returns its port.
#[tauri::command]
fn oauth_listen() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listeners().lock().unwrap().insert(port, listener);
    Ok(port)
}

const DONE_PAGE: &str = "<!doctype html><html><head><meta charset='utf-8'><title>Signed in</title></head>\
<body style='font-family:Segoe UI,sans-serif;background:#0f0f10;color:#ece8df;display:grid;place-items:center;height:100vh;margin:0'>\
<div style='text-align:center'><h2 style='font-family:Georgia,serif;font-weight:500'>You're signed in</h2>\
<p style='color:#a8a49b'>You can close this tab and go back to Command Centre.</p></div></body></html>";

/// Waits (up to 5 minutes) for the browser to come back with ?code=… and returns the path+query.
#[tauri::command]
async fn oauth_wait(port: u16) -> Result<String, String> {
    let listener = listeners()
        .lock()
        .unwrap()
        .remove(&port)
        .ok_or("Sign-in session not found")?;
    tauri::async_runtime::spawn_blocking(move || {
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let deadline = Instant::now() + Duration::from_secs(300);
        loop {
            if Instant::now() > deadline {
                return Err("Sign-in timed out".to_string());
            }
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_nonblocking(false);
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                    let mut line = String::new();
                    let _ = BufReader::new(&stream).read_line(&mut line);
                    let path = line.split_whitespace().nth(1).unwrap_or("/").to_string();
                    if path.contains("code=") || path.contains("error=") {
                        let _ = write!(
                            stream,
                            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            DONE_PAGE.len(),
                            DONE_PAGE
                        );
                        return Ok(path);
                    }
                    let _ = write!(stream, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(150));
                }
                Err(e) => return Err(e.to_string()),
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    // Web links, plus Zoom / Teams app links so "Join" opens the desktop app directly.
    let allowed = ["https://", "http://", "zoommtg://", "zoomus://", "msteams:"];
    if !allowed.iter().any(|p| url.starts_with(p)) {
        return Err("This kind of link can't be opened".into());
    }
    open::that(url).map_err(|e| e.to_string())
}

#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}


// ---------------- File vault: Documents\Command Centre Vault ----------------
fn vault_dir(app: &AppHandle) -> Result<PathBuf, String> {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    if let Some(d) = DIR.get() {
        return Ok(d.clone());
    }
    // Preferred: Documents\Command Centre Vault. If Windows blocks that (e.g. Controlled folder
    // access / ransomware protection, or a OneDrive-redirected folder that isn't available),
    // fall back to the app's own data folder so the vault always works.
    let usable = |dir: &Path| -> bool {
        if std::fs::create_dir_all(dir).is_err() {
            return false;
        }
        let probe = dir.join(".write-test");
        let ok = std::fs::write(&probe, b"ok").is_ok();
        let _ = std::fs::remove_file(&probe);
        ok
    };
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(docs) = app.path().document_dir() {
        candidates.push(docs.join("Command Centre Vault"));
    }
    if let Ok(home) = app.path().home_dir() {
        candidates.push(home.join("Command Centre Vault"));
    }
    if let Ok(data) = app.path().app_data_dir() {
        candidates.push(data.join("Vault"));
    }
    let mut errors = Vec::new();
    for c in candidates {
        if usable(&c) {
            let _ = DIR.set(c.clone());
            return Ok(c);
        }
        errors.push(c.display().to_string());
    }
    Err(format!("Windows didn't allow creating the vault folder (tried: {})", errors.join("; ")))
}

/// Resolve a relative vault path safely (no "..", no absolute paths).
fn vault_path(app: &AppHandle, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("Invalid file path".into());
    }
    Ok(vault_dir(app)?.join(rel_path))
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[derive(Serialize)]
struct VaultEntry {
    path: String,
    size: u64,
    modified: u64,
    is_dir: bool,
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<VaultEntry>) {
    let Ok(read) = std::fs::read_dir(dir) else { return };
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name.eq_ignore_ascii_case("desktop.ini") || name.eq_ignore_ascii_case("thumbs.db") {
            continue;
        }
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        let rel = path
            .strip_prefix(root)
            .map(|p| p.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect::<Vec<_>>().join("/"))
            .unwrap_or_default();
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(VaultEntry { path: rel, size: meta.len(), modified, is_dir: meta.is_dir() });
        if meta.is_dir() {
            walk(root, &path, out);
        }
    }
}

#[tauri::command]
fn vault_root(app: AppHandle) -> Result<String, String> {
    Ok(vault_dir(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
fn vault_list(app: AppHandle) -> Result<Vec<VaultEntry>, String> {
    let root = vault_dir(&app)?;
    let mut out = Vec::new();
    walk(&root, &root, &mut out);
    Ok(out)
}

#[tauri::command]
fn vault_write(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("Expected file data".into());
    };
    let rel = request
        .headers()
        .get("x-path")
        .ok_or("Missing file path")?
        .to_str()
        .map_err(|e| e.to_string())?;
    let target = vault_path(&app, &percent_decode(rel))?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&target, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn vault_open(app: AppHandle, path: String) -> Result<(), String> {
    open::that(vault_path(&app, &path)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn vault_reveal(app: AppHandle, path: String) -> Result<(), String> {
    let target = if path.is_empty() { vault_dir(&app)? } else { vault_path(&app, &path)? };
    #[cfg(target_os = "windows")]
    {
        if target.is_file() {
            return std::process::Command::new("explorer")
                .arg(format!("/select,{}", target.display()))
                .spawn()
                .map(|_| ())
                .map_err(|e| e.to_string());
        }
    }
    let dir = if target.is_dir() { target } else { target.parent().map(|p| p.to_path_buf()).unwrap_or(target) };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    open::that(dir).map_err(|e| e.to_string())
}

/// "Delete" moves the file into the vault's hidden .trash folder, so nothing is lost by accident.
#[tauri::command]
fn vault_delete(app: AppHandle, path: String) -> Result<(), String> {
    let src = vault_path(&app, &path)?;
    let trash = vault_dir(&app)?.join(".trash");
    std::fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let name = format!("{}-{}", stamp, path.replace('/', " - "));
    std::fs::rename(&src, trash.join(name)).map_err(|e| e.to_string())
}

#[tauri::command]
fn vault_move(app: AppHandle, from: String, to: String) -> Result<(), String> {
    let src = vault_path(&app, &from)?;
    let dst = vault_path(&app, &to)?;
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::rename(src, dst).map_err(|e| e.to_string())
}

/// Raw file bytes (used by sync to upload encrypted copies).
#[tauri::command]
fn vault_read(app: AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = std::fs::read(vault_path(&app, &path)?).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Small images only (for thumbnails), returned as base64.
#[tauri::command]
fn vault_read_thumb(app: AppHandle, path: String) -> Result<String, String> {
    let p = vault_path(&app, &path)?;
    let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
    if meta.len() > 12 * 1024 * 1024 {
        return Err("Too large for a preview".into());
    }
    let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn main() {
    let started_minimized = std::env::args().any(|a| a == "--minimized");

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            net_request, oauth_listen, oauth_wait, open_url, notify,
            vault_root, vault_list, vault_write, vault_open, vault_reveal, vault_delete, vault_move, vault_read_thumb, vault_read
        ])
        .setup(move |app| {
            // Start with Windows (can be turned off in Task Manager → Startup apps).
            let _ = app.autolaunch().enable();

            let open_item = MenuItem::with_id(app, "open", "Open Command Centre", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;
            TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Command Centre")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            if !started_minimized {
                show_main(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps the app running in the tray (for reminders and hourly sync).
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Command Centre");
}
