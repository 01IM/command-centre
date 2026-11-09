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
        .invoke_handler(tauri::generate_handler![net_request, oauth_listen, oauth_wait, open_url, notify])
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
