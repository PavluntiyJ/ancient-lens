//! `provider:*` and `stratz:*`: which statistics service answers, and connecting STRATZ.
use super::args::{lenient, parse};
use crate::desktop::Desktop;
use crate::store::Result;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::Emitter;

#[derive(Deserialize)]
struct Connect {
    #[serde(default, deserialize_with = "lenient")]
    token: Option<String>,
}

pub(in crate::desktop) async fn handle(
    app: &tauri::AppHandle,
    state: &Desktop,
    command: &str,
    args: &Value,
) -> Result<Value> {
    match command {
        "provider:get" => Ok(state.provider(None)),
        "provider:token" => {
            Err("Configure a local STRATZ service; see docs/guide/stats-service.md.".into())
        }
        "stratz:tokens" => {
            state
                .mode
                .open_external(crate::stratz_token::TOKENS_PAGE)
                .await?;
            Ok(json!(crate::stratz_token::TOKENS_PAGE))
        }
        "provider:connect" | "provider:disconnect" => {
            state.mode.require_secret_store()?;
            if state.explicit_service {
                return Err(
                    "The statistics service is set by ANCIENT_STATS_URL for this launch.".into(),
                );
            }
            let Ok(_changing) = state.provider_change.try_lock() else {
                return Err("STRATZ is already being connected.".into());
            };
            // The token lives only in the call's arguments, which are dropped on return.
            let outcome = if command == "provider:connect" {
                let connect = parse::<Connect>(args)?;
                crate::local_service::connect(connect.token.as_deref().unwrap_or("")).await?
            } else {
                crate::local_service::disconnect().await?
            };
            let directory = state.store.lock().await.directory.join("cache");
            state.use_service(directory, outcome.service)?;
            // The other window reloads what depends on the provider.
            let _ = app.emit("provider:update", Value::Null);
            Ok(state.provider(Some(outcome.message)))
        }
        _ => Err("Unknown command".into()),
    }
}
