use serde::Serialize;
use std::{
    fs::{create_dir_all, OpenOptions},
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem, Submenu},
    path::BaseDirectory,
    tray::TrayIconBuilder,
    Emitter, LogicalPosition, LogicalSize, Manager, Position, RunEvent, Size, WebviewWindow,
};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn service_address() -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], 3002))
}

#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{POINT, RECT},
    UI::WindowsAndMessaging::{GetCursorPos, SystemParametersInfoW, SPI_GETWORKAREA},
};

/// Snapshot of everything the JS hover state-machine needs, in LOGICAL pixels.
#[derive(Serialize)]
struct Geometry {
    cx: f64,
    cy: f64,
    wx: f64,
    wy: f64,
    ww: f64,
    wh: f64,
    work_x: f64,
    work_y: f64,
    work_w: f64,
    work_h: f64,
    scale: f64,
}

#[cfg(windows)]
fn cursor_pos() -> (f64, f64) {
    unsafe {
        let mut p = POINT { x: 0, y: 0 };
        GetCursorPos(&mut p);
        (p.x as f64, p.y as f64)
    }
}
#[cfg(not(windows))]
fn cursor_pos() -> (f64, f64) {
    (0.0, 0.0)
}

#[cfg(windows)]
fn work_area() -> (f64, f64, f64, f64) {
    unsafe {
        let mut r = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        SystemParametersInfoW(
            SPI_GETWORKAREA,
            0,
            &mut r as *mut RECT as *mut core::ffi::c_void,
            0,
        );
        (
            r.left as f64,
            r.top as f64,
            (r.right - r.left) as f64,
            (r.bottom - r.top) as f64,
        )
    }
}
#[cfg(not(windows))]
fn work_area() -> (f64, f64, f64, f64) {
    (0.0, 0.0, 1920.0, 1040.0)
}

#[tauri::command]
fn get_geometry(window: WebviewWindow) -> Result<Geometry, String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let (cxp, cyp) = cursor_pos();
    let (ax, ay, aw, ah) = work_area();
    Ok(Geometry {
        cx: cxp / scale,
        cy: cyp / scale,
        wx: pos.x as f64 / scale,
        wy: pos.y as f64 / scale,
        ww: size.width as f64 / scale,
        wh: size.height as f64 / scale,
        work_x: ax / scale,
        work_y: ay / scale,
        work_w: aw / scale,
        work_h: ah / scale,
        scale,
    })
}

#[tauri::command]
fn set_bounds(window: WebviewWindow, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    // Keep intermediate sizes off-screen. Without this transaction the webview
    // can paint the expanded card inside the 116px orb window for one frame.
    window.hide().map_err(|e| e.to_string())?;
    let update_result = (|| {
        window
            .set_position(Position::Logical(LogicalPosition::new(x, y)))
            .map_err(|e| e.to_string())?;
        window
            .set_size(Size::Logical(LogicalSize::new(w, h)))
            .map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })();
    let show_result = window.show().map_err(|e| e.to_string());
    update_result.and(show_result)
}

fn open_url(url: &str) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(url).spawn();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
}

#[tauri::command]
fn open_history() {
    open_url("http://localhost:3002");
}

fn parse_json_response(bytes: &[u8]) -> Result<serde_json::Value, String> {
    let text = String::from_utf8_lossy(bytes);
    let (head, body) = text.split_once("\r\n\r\n").ok_or("no http body")?;
    let status = head.lines().next().unwrap_or_default();
    if !status.contains(" 200 ") {
        return Err(format!("http: {status}"));
    }

    serde_json::from_str(body.trim()).map_err(|e| format!("json: {e}"))
}

fn parse_widget_response(bytes: &[u8]) -> Result<serde_json::Value, String> {
    let value = parse_json_response(bytes)?;
    let today = value.get("today").ok_or("payload: missing today")?;
    if today.is_null() {
        return Err("payload: today is null".to_string());
    }
    Ok(value)
}

fn local_http_get(
    path: &str,
    connect_timeout: Duration,
    read_timeout: Duration,
) -> Result<Vec<u8>, String> {
    let mut stream = TcpStream::connect_timeout(&service_address(), connect_timeout)
        .map_err(|e| format!("connect: {e}"))?;
    stream.set_read_timeout(Some(read_timeout)).ok();
    stream.set_write_timeout(Some(Duration::from_secs(3))).ok();
    // HTTP/1.0 => server sends a plain body and closes (no chunked encoding to parse).
    let req = format!(
        "GET {path} HTTP/1.0\r\nHost: localhost\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("write: {e}"))?;

    let mut buf = Vec::new();
    stream
        .read_to_end(&mut buf)
        .map_err(|e| format!("read: {e}"))?;
    Ok(buf)
}

/// Pull today's usage from the local Next.js server. Release builds supervise a
/// bundled server; development builds may still use an existing PM2/npm server.
#[tauri::command]
fn fetch_usage() -> Result<serde_json::Value, String> {
    let mut last_err = String::new();
    for attempt in 0..3 {
        match local_http_get(
            "/api/widget",
            Duration::from_secs(2),
            Duration::from_secs(8),
        )
        .and_then(|bytes| parse_widget_response(&bytes))
        {
            Ok(value) => return Ok(value),
            Err(error) => {
                last_err = error;
                if attempt < 2 {
                    let delay = if attempt == 0 { 400 } else { 1_200 };
                    thread::sleep(Duration::from_millis(delay));
                }
            }
        }
    }
    Err(last_err)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ServiceProbe {
    AiUsage,
    Free,
    Occupied,
}

fn probe_service() -> ServiceProbe {
    if let Ok(bytes) = local_http_get(
        "/api/health",
        Duration::from_millis(600),
        Duration::from_secs(2),
    ) {
        if let Ok(value) = parse_json_response(&bytes) {
            if value.get("service").and_then(|value| value.as_str()) == Some("ai-usage") {
                return ServiceProbe::AiUsage;
            }
        }
    }

    // Compatibility with older dashboard builds that predate /api/health.
    if let Ok(bytes) = local_http_get(
        "/api/widget",
        Duration::from_millis(600),
        Duration::from_secs(8),
    ) {
        if parse_widget_response(&bytes).is_ok() {
            return ServiceProbe::AiUsage;
        }
    }

    match TcpStream::connect_timeout(&service_address(), Duration::from_millis(400)) {
        Ok(_) => ServiceProbe::Occupied,
        Err(_) => ServiceProbe::Free,
    }
}

#[derive(Clone)]
struct ServicePaths {
    node: PathBuf,
    bootstrap: PathBuf,
    server_dir: PathBuf,
    log: PathBuf,
    state_dir: PathBuf,
}

struct DesktopService {
    shutdown: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl DesktopService {
    fn start(app: &tauri::AppHandle) -> Self {
        let shutdown = Arc::new(AtomicBool::new(false));
        let child = Arc::new(Mutex::new(None));
        let worker = Mutex::new(None);
        let service = Self {
            shutdown: Arc::clone(&shutdown),
            child: Arc::clone(&child),
            worker,
        };

        let resource_dir = match app
            .path()
            .resolve("desktop-runtime", BaseDirectory::Resource)
        {
            Ok(path) => path,
            Err(error) => {
                eprintln!("[desktop-service] cannot resolve runtime resources: {error}");
                return service;
            }
        };
        let server_dir = resource_dir.join("server");
        let paths = ServicePaths {
            node: resource_dir.join(if cfg!(windows) { "node.exe" } else { "node" }),
            bootstrap: server_dir.join("desktop-bootstrap.cjs"),
            server_dir,
            log: desktop_state_dir(app)
                .join("logs")
                .join("desktop-server.log"),
            state_dir: desktop_state_dir(app),
        };
        if !paths.node.is_file() || !paths.bootstrap.is_file() {
            // Normal for `tauri dev`, where the separately started Next server is used.
            eprintln!(
                "[desktop-service] bundled runtime is unavailable; using external 3002 service"
            );
            return service;
        }

        let worker_handle = thread::Builder::new()
            .name("ai-usage-service-supervisor".to_string())
            .spawn(move || supervise_service(paths, shutdown, child))
            .expect("failed to start desktop service supervisor");
        *service.worker.lock().expect("desktop service worker lock") = Some(worker_handle);
        service
    }

    fn stop(&self) {
        if self.shutdown.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Some(mut child) = self
            .child
            .lock()
            .expect("desktop service child lock")
            .take()
        {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some(worker) = self
            .worker
            .lock()
            .expect("desktop service worker lock")
            .take()
        {
            let _ = worker.join();
        }
    }
}

impl Drop for DesktopService {
    fn drop(&mut self) {
        self.stop();
    }
}

fn desktop_state_dir(app: &tauri::AppHandle) -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|path| path.join("ai-usage"))
        .or_else(|| app.path().app_local_data_dir().ok())
        .unwrap_or_else(std::env::temp_dir)
}

fn append_service_log(path: &Path, message: &str) {
    if let Some(parent) = path.parent() {
        let _ = create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or_default();
        let _ = writeln!(file, "[{timestamp}] {message}");
    }
}

fn spawn_bundled_service(paths: &ServicePaths) -> Result<Child, String> {
    create_dir_all(&paths.state_dir).map_err(|error| format!("state directory: {error}"))?;
    if let Some(parent) = paths.log.parent() {
        create_dir_all(parent).map_err(|error| format!("log directory: {error}"))?;
    }
    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.log)
        .map_err(|error| format!("open service log: {error}"))?;
    let stderr = stdout
        .try_clone()
        .map_err(|error| format!("clone service log: {error}"))?;

    let mut command = Command::new(&paths.node);
    command
        .arg(&paths.bootstrap)
        .current_dir(&paths.server_dir)
        .env("HOSTNAME", "127.0.0.1")
        .env("PORT", "3002")
        .env("NODE_ENV", "production")
        .env("AI_USAGE_DESKTOP_MANAGED", "1")
        .env("AI_USAGE_PARENT_PID", std::process::id().to_string())
        .env(
            "TOKEN_USAGE_STATE_FILE",
            paths.state_dir.join("token-usage.json"),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
        .spawn()
        .map_err(|error| format!("spawn bundled Next server: {error}"))
}

fn supervise_service(
    paths: ServicePaths,
    shutdown: Arc<AtomicBool>,
    child_slot: Arc<Mutex<Option<Child>>>,
) {
    let mut unhealthy_checks = 0u8;
    let mut previous_probe = None;
    append_service_log(&paths.log, "desktop service supervisor started");

    while !shutdown.load(Ordering::SeqCst) {
        let child_exited = {
            let mut slot = child_slot.lock().expect("desktop service child lock");
            match slot
                .as_mut()
                .and_then(|child| child.try_wait().ok())
                .flatten()
            {
                Some(status) => {
                    append_service_log(&paths.log, &format!("bundled server exited: {status}"));
                    *slot = None;
                    true
                }
                None => false,
            }
        };
        if child_exited {
            unhealthy_checks = 0;
        }

        let probe = probe_service();
        if previous_probe != Some(probe) {
            append_service_log(&paths.log, &format!("service probe: {probe:?}"));
            previous_probe = Some(probe);
        }

        let owns_child = child_slot
            .lock()
            .expect("desktop service child lock")
            .is_some();
        match (probe, owns_child) {
            (ServiceProbe::AiUsage, _) => unhealthy_checks = 0,
            (ServiceProbe::Free, false) => match spawn_bundled_service(&paths) {
                Ok(child) => {
                    append_service_log(
                        &paths.log,
                        &format!("bundled server started with pid {}", child.id()),
                    );
                    *child_slot.lock().expect("desktop service child lock") = Some(child);
                    unhealthy_checks = 0;
                }
                Err(error) => append_service_log(&paths.log, &error),
            },
            (ServiceProbe::Occupied, false) => {
                unhealthy_checks = 0;
            }
            (_, true) => {
                unhealthy_checks = unhealthy_checks.saturating_add(1);
                if unhealthy_checks >= 3 {
                    append_service_log(
                        &paths.log,
                        "bundled server failed health checks; restarting",
                    );
                    if let Some(mut child) = child_slot
                        .lock()
                        .expect("desktop service child lock")
                        .take()
                    {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                    unhealthy_checks = 0;
                }
            }
        }

        for _ in 0..30 {
            if shutdown.load(Ordering::SeqCst) {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
    }

    if let Some(mut child) = child_slot
        .lock()
        .expect("desktop service child lock")
        .take()
    {
        let _ = child.kill();
        let _ = child.wait();
    }
    append_service_log(&paths.log, "desktop service supervisor stopped");
}

#[cfg(test)]
mod tests {
    use super::parse_widget_response;

    #[test]
    fn parses_today_from_a_successful_widget_response() {
        let response = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"today\":{\"totalTokens\":42}}";
        let payload = parse_widget_response(response).expect("valid widget response");
        assert_eq!(payload["today"]["totalTokens"], 42);
    }

    #[test]
    fn preserves_http_status_in_diagnostic_errors() {
        let response = b"HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\n\r\n{\"error\":\"restarting\"}";
        let error = parse_widget_response(response).expect_err("503 must be rejected");
        assert_eq!(error, "http: HTTP/1.1 503 Service Unavailable");
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        // Must be registered first so a second launch focuses the existing widget
        // instead of starting another dashboard server.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            get_geometry,
            set_bounds,
            open_history,
            fetch_usage
        ])
        .setup(|app| {
            app.manage(DesktopService::start(app.handle()));
            if !cfg!(debug_assertions) {
                let autostart = app.autolaunch();
                if !autostart.is_enabled().unwrap_or(false) {
                    if let Err(error) = autostart.enable() {
                        eprintln!("[autostart] cannot enable launch at login: {error}");
                    }
                }
            }

            let win = app.get_webview_window("main").expect("main window");

            // Initial pill position: bottom-right of the work area (logical px).
            let scale = win.scale_factor().unwrap_or(1.0);
            let (ax, ay, aw, ah) = work_area();
            let (lx, ly, lw, lh) = (ax / scale, ay / scale, aw / scale, ah / scale);
            let pill_w = 112.0;
            let pill_h = 112.0;
            let x = lx + lw - pill_w - 24.0;
            let y = ly + lh - pill_h - 24.0;
            let _ = win.set_size(Size::Logical(LogicalSize::new(pill_w, pill_h)));
            let _ = win.set_position(Position::Logical(LogicalPosition::new(x, y)));
            let _ = win.show();

            // Tray + menu.
            let show_i = MenuItem::with_id(app, "show", "Show Widget", true, None::<&str>)?;
            let dash_i = MenuItem::with_id(app, "dash", "Open Full Dashboard", true, None::<&str>)?;
            let t_ocean = MenuItem::with_id(app, "theme:Ocean", "Ocean", true, None::<&str>)?;
            let t_aurora = MenuItem::with_id(app, "theme:Aurora", "Aurora", true, None::<&str>)?;
            let t_sunset = MenuItem::with_id(app, "theme:Sunset", "Sunset", true, None::<&str>)?;
            let t_lagoon = MenuItem::with_id(app, "theme:Lagoon", "Lagoon", true, None::<&str>)?;
            let theme_menu = Submenu::with_items(
                app,
                "Theme",
                true,
                &[&t_ocean, &t_aurora, &t_sunset, &t_lagoon],
            )?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &dash_i, &theme_menu, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("AI Usage Widget")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    let id = event.id.as_ref();
                    if let Some(theme) = id.strip_prefix("theme:") {
                        let _ = app.emit("theme", theme.to_string());
                    } else {
                        match id {
                            "show" => {
                                if let Some(w) = app.get_webview_window("main") {
                                    let _ = w.show();
                                }
                            }
                            "dash" => open_url("http://localhost:3002"),
                            "quit" => app.exit(0),
                            _ => {}
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            app_handle.state::<DesktopService>().stop();
        }
    });
}
