//! `app:*`, `release:*` and `log:*`: what the app is, newer releases and the log folder.
use crate::desktop::Desktop;
use crate::{overlay, store::Result};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;

pub(in crate::desktop) async fn handle(
    window: &tauri::WebviewWindow,
    state: &Desktop,
    command: &str,
) -> Result<Value> {
    match command {
        "app:info" => {
            let store = state.store.lock().await;
            Ok(
                json!({"version":env!("CARGO_PKG_VERSION"),"platform":if cfg!(windows){"win32"}else{std::env::consts::OS},"runtime":"Tauri + Rust","wayland":std::env::var_os("WAYLAND_DISPLAY").is_some(),"shortcut":state.shortcut.load(Ordering::Relaxed),"shortcutKey":store.shortcuts()["global"],"shortcutTrigger":state.shortcut_trigger.lock().ok().and_then(|t| t.clone()),"profileShortcut":state.profile_shortcut.load(Ordering::Relaxed),"profileShortcutKey":store.shortcuts()["profile"],"profileShortcutTrigger":state.profile_trigger.lock().ok().and_then(|t| t.clone()),"overlay":overlay::passive(),"autoHide":crate::foreground::available(),"keysOverGame":crate::foreground::available() && state.keys_releasable.load(Ordering::Relaxed),"keysListening":!state.keys_released.load(Ordering::Relaxed),"window":window.label(),"tray":state.tray.load(Ordering::Relaxed),"dataPath":store.directory,"logPath":crate::log::folder(&store.directory).join("ancient-lens.log"),"gsiPort":state.port.load(Ordering::Relaxed),"readerPrompt":state.mode.reader_prompt}),
            )
        }
        "release:get" => Ok(state.release_info().await),
        // Only the link of the last check is opened, never an address from the page.
        "release:open" => {
            let url = state
                .release
                .read()
                .await
                .as_ref()
                .and_then(|release| release["url"].as_str().map(String::from))
                .ok_or("No newer version is known.")?;
            state.mode.open_external(&url).await?;
            Ok(json!(url))
        }
        "log:open" => {
            let folder = crate::log::folder(&state.store.lock().await.directory);
            let path = folder.to_string_lossy().into_owned();
            state
                .mode
                .open_external(&path)
                .await
                .map_err(|_| "Could not open the folder. Its path is shown above.")?;
            Ok(json!(path))
        }
        _ => Err("Unknown command".into()),
    }
}
