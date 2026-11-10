//! Isolated-only window commands, reached after caller validation and Mode::test_command.
use super::args::{lenient, parse};
use crate::desktop::{foreground, Desktop, WINDOWS};
use crate::store::Result;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use tauri::Manager;

#[derive(Deserialize)]
struct Size {
    #[serde(default, deserialize_with = "lenient")]
    width: Option<f64>,
    #[serde(default, deserialize_with = "lenient")]
    height: Option<f64>,
}
#[derive(Deserialize)]
struct Foreground {
    #[serde(default, deserialize_with = "lenient")]
    own: Option<bool>,
    #[serde(default, deserialize_with = "lenient")]
    exe: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    initial: Option<bool>,
}

pub(in crate::desktop) fn handle(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    state: &Desktop,
    command: &str,
    args: &Value,
) -> Result<Value> {
    match command {
        // Isolated tests set the native window size, as WebDriver does on Linux; the Windows
        // driver (WebView2 debugging protocol) cannot.
        "window:test-size" => {
            let size = parse::<Size>(args)?;
            let valid = |v: Option<f64>| v.filter(|v| (100.0..=10000.0).contains(v));
            let (width, height) = valid(size.width)
                .zip(valid(size.height))
                .ok_or("Invalid window size")?;
            if window.is_maximized().map_err(|e| e.to_string())? {
                window.unmaximize().map_err(|e| e.to_string())?;
            }
            window
                .set_size(tauri::LogicalSize::new(width, height))
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        // Isolated tests do not watch the active window (see `run`); they report an activation
        // here instead: one of this app's windows, or another program by its file name.
        "window:test-foreground" => {
            let activation = parse::<Foreground>(args)?;
            let pid = if activation.own == Some(true) {
                std::process::id()
            } else {
                0
            };
            let hidden = foreground(
                app,
                pid,
                activation.exe.as_deref(),
                activation.initial == Some(true),
            );
            let minimized = WINDOWS.map(|label| {
                app.get_webview_window(label)
                    .is_some_and(|w| w.is_minimized().unwrap_or(false))
            });
            Ok(
                json!({"hidden": hidden, "minimized": minimized, "keys": !state.keys_released.load(Ordering::Relaxed)}),
            )
        }
        _ => Err("Unknown command".into()),
    }
}
