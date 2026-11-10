//! `state:*`, `note:*`, `mmr:*` and `journal:*`: the saved state. The store reads each
//! change's own arguments; this module applies what a change means for the running app.
use super::args::{lenient, parse, Id};
use crate::desktop::{global_keys, listen, Desktop};
use crate::store::Result;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager};
#[cfg(not(target_os = "linux"))]
use tauri_plugin_global_shortcut::GlobalShortcutExt;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Medal {
    #[serde(default, deserialize_with = "lenient")]
    match_id: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    tier: Option<u64>,
}
#[derive(Deserialize)]
struct Shortcuts {
    /// Checked by `validate_shortcuts`, which has the messages for each kind of mistake.
    #[serde(default)]
    shortcuts: Value,
}

pub(in crate::desktop) async fn handle(
    app: &tauri::AppHandle,
    state: &Desktop,
    command: &str,
    args: &Value,
) -> Result<Value> {
    match command {
        "state:get" => Ok(state.store.lock().await.public()),
        "state:profile-account" => {
            let id = parse::<Id>(args)?;
            state.store.lock().await.profile_account(id.id())
        }
        // One consent for every memory reader: roster/picks and own rating, Linux and Windows.
        "state:reader" => {
            if !cfg!(any(target_os = "linux", windows)) {
                return Err("Dota memory reading is not supported on this platform".into());
            }
            let mut store = state.store.lock().await;
            let value = store.change(command, args)?;
            #[cfg(any(target_os = "linux", windows))]
            state
                .gsi
                .set_reader(value["nativeRosterReader"] == "on")
                .await;
            let _ = app.emit("state:update", &value);
            Ok(value)
        }
        "state:account"
        | "state:add-profile"
        | "state:remove-profile"
        | "note:add"
        | "note:edit"
        | "note:delete-entry"
        | "note:delete"
        | "mmr:add"
        | "mmr:delete" => {
            let value = state.store.lock().await.change(command, args)?;
            let _ = app.emit("state:update", &value);
            Ok(value)
        }
        "state:update-check" | "state:skip-version" => {
            let value = state.store.lock().await.change(command, args)?;
            if command == "state:update-check" && value["updateCheck"] == true {
                state.release_wake.notify_one();
            }
            let _ = app.emit("state:update", &value);
            Ok(value)
        }
        "state:tray" => {
            let value = state.store.lock().await.change(command, args)?;
            state
                .close_to_tray
                .store(value["closeToTray"] == true, Ordering::Relaxed);
            let _ = app.emit("state:update", &value);
            Ok(value)
        }
        "state:auto-hide" => {
            let value = state.store.lock().await.change(command, args)?;
            state
                .auto_hide
                .store(value["autoHide"] == true, Ordering::Relaxed);
            let _ = app.emit("state:update", &value);
            Ok(value)
        }
        "state:keys-over-game" => {
            let value = state.store.lock().await.change(command, args)?;
            let on = value["keysOverGame"] == true;
            state.keys_over_game.store(on, Ordering::Relaxed);
            // Turned off, the keys listen everywhere at once; turned on, from the next switch.
            if !on {
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    listen(&handle, &handle.state::<Desktop>(), true);
                });
            }
            let _ = app.emit("state:update", &value);
            Ok(value)
        }
        // A global binding can fail because another application owns the combination; in
        // that case the store keeps the old object and the page shows the conflict.
        "state:shortcuts" => {
            let requested = crate::store::validate_shortcuts(&parse::<Shortcuts>(args)?.shortcuts)?;
            let mut store = state.store.lock().await;
            let next = global_keys(&requested);
            #[cfg(not(target_os = "linux"))]
            {
                let previous = global_keys(&store.shortcuts());
                let rebound = crate::desktop::rebind(app, &previous, &next);
                // Released keys stay released: registering only checked them for conflicts.
                if state.keys_released.load(Ordering::Relaxed) {
                    let kept = if rebound.is_ok() { &next } else { &previous };
                    for key in kept {
                        let _ = app.global_shortcut().unregister(key.as_str());
                    }
                }
                rebound?;
                for (i, bound) in [&state.shortcut, &state.profile_shortcut]
                    .into_iter()
                    .enumerate()
                {
                    if previous[i] != next[i] {
                        bound.store(true, Ordering::Relaxed);
                    }
                }
            }
            let value = store.change(command, &json!({"shortcuts":requested}))?;
            if let Ok(mut keys) = state.global_keys.lock() {
                *keys = next;
            }
            let _ = app.emit("state:update", &value);
            Ok(value)
        }
        "journal:medal" => {
            let medal = parse::<Medal>(args)?;
            let id = medal.match_id.and_then(|id| id.parse::<u64>().ok());
            let mut store = state.store.lock().await;
            if store.medal_rank(id.unwrap_or(0), medal.tier.unwrap_or(0))? {
                let _ = app.emit("state:update", store.public());
            }
            Ok(Value::Null)
        }
        _ => Err("Unknown command".into()),
    }
}
