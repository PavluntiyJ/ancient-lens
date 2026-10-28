use serde_json::{json, Map, Value};
use std::path::PathBuf;
use tokio::{io::AsyncWriteExt, sync::Mutex};

const MAX_BYTES: u64 = 1024 * 1024;
pub(super) struct Diagnostics {
    path: PathBuf,
    /// The last written summary without its timestamp: unchanged packets are skipped,
    /// so a long match cannot push the draft phase out of the size-limited file.
    writer: Mutex<Option<Value>>,
    max_bytes: u64,
}
impl Diagnostics {
    pub fn from_env(directory: PathBuf) -> Option<Self> {
        Self::configured(
            directory,
            std::env::var("ANCIENT_GSI_DRAFT_DIAGNOSTICS")
                .ok()
                .as_deref(),
        )
    }
    fn configured(directory: PathBuf, setting: Option<&str>) -> Option<Self> {
        (setting == Some("1")).then(|| Self {
            path: directory.join("gsi-draft-diagnostics.jsonl"),
            writer: Mutex::new(None),
            max_bytes: MAX_BYTES,
        })
    }
    pub async fn record(&self, packet: &Value, normalized: &Value) -> std::io::Result<()> {
        let summary = summary(packet, normalized);
        let mut line = serde_json::to_vec(&summary)?;
        line.push(b'\n');
        if line.len() as u64 > self.max_bytes {
            return Ok(());
        }
        let mut last = self.writer.lock().await;
        let mut content = summary;
        if let Some(object) = content.as_object_mut() {
            object.remove("timestamp");
        }
        if last.as_ref() == Some(&content) {
            return Ok(());
        }
        let length = match tokio::fs::metadata(&self.path).await {
            Ok(meta) => meta.len(),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => 0,
            Err(e) => return Err(e),
        };
        let rotate = length + line.len() as u64 > self.max_bytes;
        let mut options = tokio::fs::OpenOptions::new();
        options
            .create(true)
            .write(true)
            .append(!rotate)
            .truncate(rotate);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options.open(&self.path).await?;
        file.write_all(&line).await?;
        file.flush().await?;
        *last = Some(content);
        Ok(())
    }
}
fn private_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    ["steam", "account", "name", "token", "auth"]
        .iter()
        .any(|word| lower.contains(word))
}
fn slot_key(key: &str, prefix: &str, suffix: &str) -> bool {
    key.strip_prefix(prefix)
        .and_then(|s| s.strip_suffix(suffix))
        .is_some_and(|s| s.len() <= 2 && s.parse::<u8>().is_ok_and(|n| n < 32))
}
fn known_key(key: &str) -> bool {
    matches!(
        key,
        "team2"
            | "team3"
            | "radiant"
            | "dire"
            | "picks"
            | "bans"
            | "hero_id"
            | "heroId"
            | "id"
            | "hero"
            | "team"
            | "team_id"
            | "active_team"
            | "activeteam"
            | "activeteam_time_remaining"
            | "radiant_bonus_time"
            | "dire_bonus_time"
            | "home_team"
            | "pick"
            | "ban"
            | "type"
            | "order"
            | "is_pick"
            | "time_remaining"
            | "bonus_time"
            | "pick_phase"
            | "ban_phase"
    ) || slot_key(key, "pick", "_id")
        || slot_key(key, "ban", "_id")
        || slot_key(key, "pick", "_class")
        || slot_key(key, "ban", "_class")
}
fn hero_id(value: &Value) -> bool {
    value.as_u64().is_some_and(|id| (1..=1000).contains(&id))
}
fn entry_has_hero(value: &Value) -> bool {
    hero_id(value)
        || ["hero_id", "heroId", "id", "hero"]
            .iter()
            .any(|key| hero_id(&value[*key]))
}
// Never serialize scalar values or arbitrary keys: a key itself can contain PII.
fn shape(value: &Value, depth: usize, budget: &mut usize) -> Value {
    if *budget == 0 || depth > 6 {
        return json!({"type":"omitted"});
    }
    *budget -= 1;
    match value {
        Value::Object(object) => {
            let mut fields = Map::new();
            for (index, (key, child)) in object
                .iter()
                .filter(|(key, _)| !private_key(key))
                .take(64)
                .enumerate()
            {
                let label = if known_key(key) {
                    key.clone()
                } else {
                    format!("field_{index}")
                };
                let mut node = shape(child, depth + 1, budget);
                if matches!(key.as_str(), "hero_id" | "heroId" | "id" | "hero")
                    || slot_key(key, "pick", "_id")
                    || slot_key(key, "ban", "_id")
                {
                    node["heroIdPresent"] = json!(hero_id(child));
                }
                fields.insert(label, node);
                if *budget == 0 {
                    break;
                }
            }
            json!({"type":"object","count":object.len(),"fields":fields})
        }
        Value::Array(array) => {
            let mut items = vec![];
            for child in array.iter().take(16) {
                if *budget == 0 {
                    break;
                }
                items.push(shape(child, depth + 1, budget));
            }
            json!({"type":"array","count":array.len(),"items":items})
        }
        Value::Null => json!({"type":"null"}),
        Value::Bool(_) => json!({"type":"boolean"}),
        Value::Number(_) => json!({"type":"number"}),
        Value::String(_) => json!({"type":"string"}),
    }
}
fn team_summary(value: &Value) -> Value {
    let count = value
        .as_array()
        .map(Vec::len)
        .or_else(|| value.as_object().map(Map::len));
    let mut out = json!({"elements":count});
    for (kind, prefix) in [("picks", "pick"), ("bans", "ban")] {
        let rows = value[kind].as_array();
        let slots: Vec<_> = value
            .as_object()
            .into_iter()
            .flat_map(|v| v.iter())
            .filter(|(key, _)| slot_key(key, prefix, "_id"))
            .map(|(_, v)| v)
            .collect();
        let known = rows.is_some() || !slots.is_empty();
        out[kind] = if known {
            json!({
                "slots":rows.map_or(0, Vec::len) + slots.len(),
                "withHeroId":rows.map_or(0, |rows| rows.iter().filter(|v| entry_has_hero(v)).count()) + slots.iter().filter(|v| hero_id(v)).count()
            })
        } else {
            Value::Null
        };
    }
    out
}
fn summary(packet: &Value, normalized: &Value) -> Value {
    let phase = match normalized["gameState"].as_str() {
        Some(
            s @ ("DOTA_GAMERULES_STATE_INIT"
            | "DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD"
            | "DOTA_GAMERULES_STATE_HERO_SELECTION"
            | "DOTA_GAMERULES_STATE_STRATEGY_TIME"
            | "DOTA_GAMERULES_STATE_TEAM_SHOWCASE"
            | "DOTA_GAMERULES_STATE_PRE_GAME"
            | "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS"
            | "DOTA_GAMERULES_STATE_POST_GAME"
            | "DOTA_GAMERULES_STATE_DISCONNECT"
            | "DOTA_GAMERULES_STATE_CUSTOM_GAME_SETUP"
            | "DOTA_GAMERULES_STATE_WAIT_FOR_MAP_TO_LOAD"
            | "DOTA_GAMERULES_STATE_SCENARIO_SETUP"
            | "DOTA_GAMERULES_STATE_PLAYER_DRAFT"),
        ) => s,
        _ => "unknown",
    };
    let draft = packet.get("draft");
    let mut teams = Map::new();
    for team in ["team2", "team3", "radiant", "dire"] {
        if let Some(value) = draft.and_then(|v| v.get(team)) {
            teams.insert(team.into(), team_summary(value));
        }
    }
    json!({"timestamp":crate::store::now(),"phase":phase,
        "mode":if normalized["mode"] == "spectator" {"spectator"} else {"player"},
        "draft":draft.map(|v|shape(v,0,&mut 256)).unwrap_or(json!({"type":"missing"})),"teams":teams})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn real_draft_keys_preserve_structure_without_scalar_values() {
        let dir = tempfile::tempdir().unwrap();
        let log = Diagnostics::configured(dir.path().into(), Some("1")).unwrap();
        let team = json!({"home_team":true,"pick0_id":123,"pick0_class":"npc_dota_hero_axe",
            "ban5_id":456,"ban5_class":"npc_dota_hero_lina","steamid":"76561197960265729",
            "name":"Private Person","token":"private-token"});
        let packet = json!({"draft":{"activeteam":2,"pick":false,"activeteam_time_remaining":9876,
            "radiant_bonus_time":8765,"dire_bonus_time":7654,"team2":team,"team3":team}});
        log.record(&packet, &json!({})).await.unwrap();
        let text = tokio::fs::read_to_string(&log.path).await.unwrap();
        let value: Value = serde_json::from_str(text.trim()).unwrap();
        let fields = &value["draft"]["fields"];
        for key in [
            "activeteam",
            "activeteam_time_remaining",
            "radiant_bonus_time",
            "dire_bonus_time",
        ] {
            assert!(!private_key(key));
            assert_eq!(fields[key], json!({"type":"number"}));
        }
        assert_eq!(fields["pick"], json!({"type":"boolean"}));
        for key in [
            "home_team",
            "pick0_id",
            "pick0_class",
            "ban5_id",
            "ban5_class",
        ] {
            assert!(!private_key(key));
            assert!(known_key(key));
        }
        for team in ["team2", "team3"] {
            let fields = &fields[team]["fields"];
            assert_eq!(fields.as_object().unwrap().len(), 5);
            assert_eq!(fields["home_team"], json!({"type":"boolean"}));
            for key in ["pick0_class", "ban5_class"] {
                assert_eq!(fields[key], json!({"type":"string"}));
            }
            for key in ["pick0_id", "ban5_id"] {
                assert_eq!(fields[key], json!({"type":"number","heroIdPresent":true}));
            }
            assert_eq!(
                value["teams"][team]["picks"],
                json!({"slots":1,"withHeroId":1})
            );
            assert_eq!(
                value["teams"][team]["bans"],
                json!({"slots":1,"withHeroId":1})
            );
        }
        for forbidden in [
            "steamid",
            "name",
            "token",
            "npc_dota_hero",
            "Private Person",
            "76561197960265729",
            "field_",
        ] {
            assert!(!text.contains(forbidden), "{forbidden}");
        }
    }
    #[tokio::test]
    async fn diagnostic_is_opt_in_bounded_and_never_copies_identity_or_values() {
        let dir = tempfile::tempdir().unwrap();
        for setting in [None, Some("0"), Some("true")] {
            assert!(Diagnostics::configured(dir.path().into(), setting).is_none());
        }
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
        let mut log = Diagnostics::configured(dir.path().into(), Some("1")).unwrap();
        log.max_bytes = 4096;
        let packet = json!({"auth":{"token":"secret-token"},"draft":{"team2":{
            "pick0_id":1,"ban0_id":0,"name":"Secret Person","steamid":"76561197960265729",
            "picks":[{"hero_id":2,"token":"secret-token"}],"Secret Person":{"heroId":3},"76561197960265729":"secret-value"},
            "team3":{"bans":[{"heroId":4}],"picks":[]}},"player":{"name":"Secret Person"}});
        let normalized = json!({"gameState":"DOTA_GAMERULES_STATE_HERO_SELECTION","mode":"player"});
        for _ in 0..20 {
            log.record(&packet, &normalized).await.unwrap();
        }
        let text = tokio::fs::read_to_string(&log.path).await.unwrap();
        assert!(text.len() <= 4096);
        for forbidden in [
            "steamid",
            "name",
            "token",
            "Secret Person",
            "76561197960265729",
            "secret-value",
        ] {
            assert!(!text.contains(forbidden), "{forbidden}");
        }
        let value: Value = serde_json::from_str(text.lines().last().unwrap()).unwrap();
        assert_eq!(value["teams"]["team2"]["picks"]["withHeroId"], 2);
        assert_eq!(value["teams"]["team2"]["bans"]["withHeroId"], 0);
        assert_eq!(value["teams"]["team3"]["bans"]["withHeroId"], 1);
        assert_eq!(
            value["draft"]["fields"]["team2"]["fields"]["pick0_id"]["heroIdPresent"],
            true
        );
        assert_eq!(value["phase"], "DOTA_GAMERULES_STATE_HERO_SELECTION");
        assert!(summary(&json!({}), &json!({}))["draft"]["type"] == "missing");
        assert!(summary(&json!({"draft":{}}), &json!({}))["draft"]["type"] == "object");
        let large = json!({"draft":vec![vec![json!({"id":1});100];100]});
        assert!(summary(&large, &normalized).to_string().len() < 32_000);
    }
}
