//! `gsi:export` and `data:export`: save the game's integration file or a backup of the
//! saved state where the user chooses.
use crate::desktop::Desktop;
use crate::{gsi, store::Result};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;

pub(in crate::desktop) async fn handle(state: &Desktop, command: &str) -> Result<Value> {
    let (content, default_name) = match command {
        "gsi:export" => (
            gsi::config(
                &state.store.lock().await.token(),
                state.port.load(Ordering::Relaxed),
            ),
            "gamestate_integration_ancient_lens.cfg",
        ),
        "data:export" => (
            serde_json::to_string_pretty(&state.store.lock().await.export())
                .map_err(|e| e.to_string())?,
            "ancient-lens-backup.json",
        ),
        _ => return Err("Unknown command".into()),
    };
    let path = rfd::AsyncFileDialog::new()
        .set_file_name(default_name)
        .save_file()
        .await;
    if let Some(path) = path {
        tokio::fs::write(path.path(), content)
            .await
            .map_err(|e| e.to_string())?;
        Ok(json!(path.path().to_string_lossy()))
    } else {
        Ok(Value::Null)
    }
}
