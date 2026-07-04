use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem, Submenu},
    tray::TrayIconBuilder,
    Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewWindow,
};

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
    window
        .set_size(Size::Logical(LogicalSize::new(w, h)))
        .map_err(|e| e.to_string())?;
    window
        .set_position(Position::Logical(LogicalPosition::new(x, y)))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn open_url(url: &str) {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
}

#[tauri::command]
fn open_history() {
    open_url("http://localhost:3002");
}

/// Pull today's usage from the local Next.js server (started separately, e.g. PM2).
/// Uses a tiny std-only HTTP/1.0 GET so we pull ZERO extra crates.
/// Retries once on connect failure (the dashboard may be mid-restart).
#[tauri::command]
fn fetch_usage() -> Result<serde_json::Value, String> {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    // Try connect, retry once after 400ms if the server isn't up yet.
    let mut stream = None;
    let mut last_err = String::new();
    for attempt in 0..2 {
        match TcpStream::connect("127.0.0.1:3002") {
            Ok(s) => { stream = Some(s); break; }
            Err(e) => {
                last_err = format!("connect: {e}");
                if attempt == 0 { std::thread::sleep(Duration::from_millis(400)); }
            }
        }
    }
    let mut stream = stream.ok_or(last_err)?;
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(5))).ok();

    // HTTP/1.0 => server sends a plain body and closes (no chunked encoding to parse).
    let req = "GET /api/usage?days=1 HTTP/1.0\r\n\
               Host: localhost\r\n\
               Accept: application/json\r\n\
               Connection: close\r\n\r\n";
    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("write: {e}"))?;

    let mut buf = Vec::new();
    stream
        .read_to_end(&mut buf)
        .map_err(|e| format!("read: {e}"))?;

    let text = String::from_utf8_lossy(&buf);
    let body = text
        .split_once("\r\n\r\n")
        .map(|(_, b)| b)
        .ok_or("no http body")?;

    let v: serde_json::Value =
        serde_json::from_str(body.trim()).map_err(|e| format!("json: {e}"))?;
    Ok(v.get("today").cloned().unwrap_or(serde_json::Value::Null))
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_geometry,
            set_bounds,
            open_history,
            fetch_usage
        ])
        .setup(|app| {
            let win = app.get_webview_window("main").expect("main window");

            // Initial pill position: bottom-right of the work area (logical px).
            let scale = win.scale_factor().unwrap_or(1.0);
            let (ax, ay, aw, ah) = work_area();
            let (lx, ly, lw, lh) = (ax / scale, ay / scale, aw / scale, ah / scale);
            let pill_w = 116.0;
            let pill_h = 116.0;
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
