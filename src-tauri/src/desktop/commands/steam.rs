//! `steam:*`: Steam profiles, and checking and repairing the game's Steam setup.
use super::args::{lenient, parse};
use crate::desktop::Desktop;
use crate::{error::Error, gsi, steam_setup, store::Result};
use serde::Deserialize;
use serde_json::Value;
use std::sync::atomic::Ordering;

#[derive(Deserialize)]
struct Profile {
    #[serde(default, deserialize_with = "lenient")]
    id: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    refresh: Option<bool>,
}
#[derive(Deserialize)]
struct Repair {
    #[serde(default, deserialize_with = "lenient")]
    launch: Option<bool>,
}

pub(in crate::desktop) async fn handle(
    state: &Desktop,
    command: &str,
    args: &Value,
) -> Result<Value> {
    match command {
        "steam:profile" => {
            let profile = parse::<Profile>(args)?;
            state
                .api()
                .steam_profile(
                    profile.id.as_deref().unwrap_or(""),
                    profile.refresh == Some(true),
                )
                .await
        }
        "steam:status" => {
            if let Some(status) = state.mode.steam_status(false)? {
                return serde_json::to_value(status).map_err(Error::from);
            }
            let (config, memory) = {
                let store = state.store.lock().await;
                let port = state.port.load(Ordering::Relaxed);
                (gsi::config(&store.token(), port), store.memory_reader())
            };
            let status = tokio::task::spawn_blocking(move || {
                steam_setup::inspect(&steam_setup::host(memory), &config)
            })
            .await
            .map_err(|e| e.to_string())?;
            serde_json::to_value(status).map_err(Error::from)
        }
        "steam:repair" => {
            state.mode.steam_status(true)?;
            let Ok(_running) = state.steam_repair.try_lock() else {
                return Err("Steam setup is already running.".into());
            };
            if steam_setup::in_match(
                &*state.live.read().await,
                chrono::Utc::now().timestamp_millis(),
            ) {
                return Err("Finish the current match first: the setup closes Dota 2.".into());
            }
            let launch = parse::<Repair>(args)?.launch.unwrap_or(false);
            let (config, memory) = {
                let store = state.store.lock().await;
                let port = state.port.load(Ordering::Relaxed);
                (gsi::config(&store.token(), port), store.memory_reader())
            };
            let outcome = tokio::task::spawn_blocking(move || {
                steam_setup::repair(&steam_setup::host(memory), &config, launch)
            })
            .await
            .map_err(|e| e.to_string())??;
            serde_json::to_value(outcome).map_err(Error::from)
        }
        _ => Err("Unknown command".into()),
    }
}
