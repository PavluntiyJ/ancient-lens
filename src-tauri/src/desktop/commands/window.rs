//! `window:*`: moving, sizing and showing the match and profile windows.
use super::args::{lenient, parse};
use crate::desktop::{min_size, show, toggle, MATCH, MATCH_MIN, PROFILE, PROFILE_MIN};
use crate::{overlay, store::Result};
use serde::Deserialize;
use serde_json::{json, Value};

/// Generic because Tauri does not export its edge type; `start_resize_dragging` names it.
#[derive(Deserialize)]
#[serde(bound = "D: serde::de::DeserializeOwned")]
struct Resize<D> {
    #[serde(default, deserialize_with = "lenient")]
    edge: Option<D>,
}
#[derive(Deserialize)]
struct MinSize {
    #[serde(default, deserialize_with = "lenient")]
    scale: Option<f64>,
}
#[derive(Deserialize)]
struct Action {
    #[serde(default, deserialize_with = "lenient")]
    action: Option<String>,
}
#[derive(Deserialize)]
struct Target {
    #[serde(default, deserialize_with = "lenient")]
    window: Option<String>,
}
#[derive(Deserialize)]
struct Keyboard {
    #[serde(default, deserialize_with = "lenient")]
    on: Option<bool>,
}

pub(in crate::desktop) fn handle(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    command: &str,
    args: &Value,
) -> Result<Value> {
    match command {
        "window:resize" => {
            let direction = parse::<Resize<_>>(args)?
                .edge
                .ok_or("Unknown window edge")?;
            if !window.is_maximized().map_err(|e| e.to_string())? {
                window
                    .as_ref()
                    .window()
                    .start_resize_dragging(direction)
                    .map_err(|e| e.to_string())?;
            }
            Ok(Value::Null)
        }
        "window:min-size" => {
            let scale = parse::<MinSize>(args)?
                .scale
                .filter(|scale| (50.0..=200.0).contains(scale))
                .ok_or("Invalid interface scale")?;
            let monitor = window
                .current_monitor()
                .map_err(|e| e.to_string())?
                .ok_or("No monitor")?;
            let factor = monitor.scale_factor();
            let work = monitor.work_area().size;
            let base = if window.label() == PROFILE {
                PROFILE_MIN
            } else {
                MATCH_MIN
            };
            let (width, height) = min_size(
                base,
                scale,
                (work.width as f64 / factor, work.height as f64 / factor),
            );
            window
                .set_min_size(Some(tauri::LogicalSize::new(width, height)))
                .map_err(|e| e.to_string())?;
            // A window already smaller than the new minimum grows to it.
            let inner = window
                .inner_size()
                .map_err(|e| e.to_string())?
                .to_logical::<f64>(factor);
            if !window.is_maximized().map_err(|e| e.to_string())?
                && (inner.width < width || inner.height < height)
            {
                window
                    .set_size(tauri::LogicalSize::new(
                        inner.width.max(width),
                        inner.height.max(height),
                    ))
                    .map_err(|e| e.to_string())?;
            }
            Ok(json!({"width": width, "height": height}))
        }
        "window:action" => {
            match parse::<Action>(args)?.action.as_deref().unwrap_or("") {
                "drag" => window.start_dragging(),
                "minimize" => {
                    overlay::minimize(&window.as_ref().window());
                    Ok(())
                }
                "maximize" => {
                    if window.is_maximized().map_err(|e| e.to_string())? {
                        window.unmaximize()
                    } else {
                        window.maximize()
                    }
                }
                "close" => window.close(),
                _ => return Err("Unknown window action".into()),
            }
            .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        // Either window by label; the match window when none is given.
        "window:toggle" | "window:show" => {
            let label = match parse::<Target>(args)?.window.as_deref() {
                None | Some(MATCH) => MATCH,
                Some(PROFILE) => PROFILE,
                Some(_) => return Err("Unknown window".into()),
            };
            if command == "window:show" {
                show(app, label);
                Ok(json!(true))
            } else {
                Ok(json!(toggle(app, label)?))
            }
        }
        // The user clicked a text field or the keyboard button of this window.
        "window:keyboard" => {
            let on = parse::<Keyboard>(args)?.on == Some(true);
            overlay::keyboard(&window.as_ref().window(), on);
            Ok(Value::Null)
        }
        _ => Err("Unknown command".into()),
    }
}
