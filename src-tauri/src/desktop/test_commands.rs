//! Isolated-only IPC, reached after caller validation and Mode::test_command.
use super::*;
pub(super) fn handle(
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
            let size = |key: &str| args[key].as_f64().filter(|v| (100.0..=10000.0).contains(v));
            let (width, height) = size("width")
                .zip(size("height"))
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
            let pid = if args["own"] == true {
                std::process::id()
            } else {
                0
            };
            let hidden = foreground(app, pid, args["exe"].as_str(), args["initial"] == true);
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
