mod diagnostics;
use crate::store::{account_id, Result};
use axum::{
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    routing::post,
    Router,
};
use serde_json::{json, Value};
use std::{collections::BTreeSet, sync::Arc, time::Duration};
use subtle::ConstantTimeEq;
use tokio::sync::{Mutex, RwLock};

fn stats(player: &Value, hero: &Value) -> Value {
    let mut v = json!({});
    if let Some(slot) = player["team_slot"].as_u64().filter(|slot| *slot < 5) {
        v["teamSlot"] = json!(slot);
    }
    if let Some(steam) = player["steamid"]
        .as_str()
        .filter(|s| s.parse::<u64>().is_ok_and(|id| id > 76561197960265728))
    {
        if let Ok(id) = account_id(steam) {
            v["accountId"] = json!(id);
        }
    }
    for (from, to) in [
        ("kills", "kills"),
        ("deaths", "deaths"),
        ("assists", "assists"),
        ("last_hits", "lastHits"),
        ("denies", "denies"),
        ("gold", "gold"),
        ("gpm", "gpm"),
        ("xpm", "xpm"),
        ("net_worth", "netWorth"),
        ("hero_damage", "heroDamage"),
        ("tower_damage", "towerDamage"),
        ("hero_healing", "heroHealing"),
    ] {
        if player[from].is_number() {
            v[to] = player[from].clone();
        }
    }
    for (from, to) in [
        ("id", "heroId"),
        ("health", "health"),
        ("max_health", "maxHealth"),
        ("mana", "mana"),
        ("max_mana", "maxMana"),
        ("level", "level"),
    ] {
        if hero[from].is_number() {
            v[to] = hero[from].clone();
        }
    }
    if let Some(name) = hero["name"].as_str() {
        v["heroName"] = json!(name);
        v["hero"] = json!(name.trim_start_matches("npc_dota_hero_").replace('_', " "));
    }
    v
}
pub fn normalize(v: &Value, token: &str) -> Result<Value> {
    let supplied = v["auth"]["token"].as_str().unwrap_or("");
    if !bool::from(supplied.as_bytes().ct_eq(token.as_bytes())) {
        return Err("Unauthorized".into());
    }
    if v["provider"]["appid"] != 570 {
        return Err("Invalid GSI format".into());
    }
    let mut players = vec![];
    for (team, name) in [("team2", "radiant"), ("team3", "dire")] {
        let keys: BTreeSet<&String> = [v["player"][team].as_object(), v["hero"][team].as_object()]
            .into_iter()
            .flatten()
            .flat_map(|m| m.keys())
            .collect();
        for key in keys {
            if key.len() != 7 || !key.starts_with("player") || !key.as_bytes()[6].is_ascii_digit() {
                return Err("Invalid GSI slot".into());
            }
            let p = &v["player"][team][key];
            let mut row = stats(p, &v["hero"][team][key]);
            row["key"] = json!(format!("{team}.{key}"));
            row["team"] = json!(name);
            row["name"] = p["name"].clone();
            players.push(row);
        }
    }
    let spectator = !players.is_empty();
    let mut out = stats(&v["player"], &v["hero"]);
    if !spectator && ["radiant", "dire"].contains(&v["player"]["team_name"].as_str().unwrap_or(""))
    {
        let mut row = out.clone();
        row["key"] = json!("self");
        row["team"] = v["player"]["team_name"].clone();
        row["name"] = v["player"]["name"].clone();
        if let Some(slot) = row.get("teamSlot") {
            out["selfTeamSlot"] = slot.clone();
        }
        players.push(row);
    }
    out["status"] = json!("connected");
    out["receivedAt"] = json!(chrono::Utc::now().timestamp_millis());
    if !v["map"]["matchid"].is_null() {
        out["matchId"] = json!(v["map"]["matchid"]
            .as_str()
            .map(String::from)
            .unwrap_or_else(|| v["map"]["matchid"].to_string()));
    }
    for (from, to) in [
        ("radiant_score", "radiantScore"),
        ("dire_score", "direScore"),
    ] {
        if v["map"][from].is_number() {
            out[to] = v["map"][from].clone();
        }
    }
    if v["map"]["clock_time"].is_number() {
        out["clock"] = v["map"]["clock_time"].clone();
    }
    if v["map"]["game_state"].is_string() {
        out["gameState"] = v["map"]["game_state"].clone();
    }
    if let Some(team) = v["map"]["win_team"]
        .as_str()
        .filter(|team| ["radiant", "dire"].contains(team))
    {
        out["winTeam"] = json!(team);
    }
    out["mode"] = json!(if spectator { "spectator" } else { "player" });
    out["players"] = json!(players);
    Ok(out)
}
pub fn config(token: &str, port: u16) -> String {
    format!("\"Ancient Lens\"\n{{\n    \"uri\" \"http://127.0.0.1:{port}/gsi\"\n    \"timeout\" \"5.0\"\n    \"buffer\" \"0.5\"\n    \"throttle\" \"0.5\"\n    \"heartbeat\" \"10.0\"\n    \"data\"\n    {{\n        \"provider\" \"1\"\n        \"map\" \"1\"\n        \"player\" \"1\"\n        \"hero\" \"1\"\n        \"draft\" \"1\"\n    }}\n    \"auth\"\n    {{\n        \"token\" \"{token}\"\n    }}\n}}\n")
}
struct Routing {
    latest: Value,
    #[cfg(any(target_os = "linux", windows))]
    worker: Option<crate::roster::Worker>,
}
pub struct Control {
    routing: Mutex<Routing>,
    live: Arc<RwLock<Value>>,
    update: Arc<dyn Fn(Value) + Send + Sync>,
    recorder: std::sync::Mutex<crate::journal::Recorder>,
    /// Receives each played match once it ends, from raw GSI and independent of the reader.
    finished: Box<dyn Fn(Value) + Send + Sync>,
    #[cfg(any(target_os = "linux", windows))]
    isolated: bool,
}
impl Control {
    fn new(
        live: Arc<RwLock<Value>>,
        update: Arc<dyn Fn(Value) + Send + Sync>,
        finished: Box<dyn Fn(Value) + Send + Sync>,
        _isolated: bool,
    ) -> Self {
        Self {
            routing: Mutex::new(Routing {
                latest: json!({"status":"waiting","receivedAt":null}),
                #[cfg(any(target_os = "linux", windows))]
                worker: None,
            }),
            live,
            update,
            recorder: Default::default(),
            finished,
            #[cfg(any(target_os = "linux", windows))]
            isolated: _isolated,
        }
    }
    async fn publish(&self, value: Value, _enabled: bool) {
        #[cfg(any(target_os = "linux", windows))]
        let value = {
            let mut value = value;
            value["rosterStatus"] = json!(if _enabled { "waiting" } else { "disabled" });
            value
        };
        *self.live.write().await = value.clone();
        (self.update)(value);
    }
    #[cfg(any(target_os = "linux", windows))]
    pub async fn set_reader(&self, enabled: bool) {
        let mut routing = self.routing.lock().await;
        if enabled == routing.worker.is_some() {
            return;
        }
        if let Some(worker) = routing.worker.take() {
            worker.stop().await;
        }
        // Restore raw GSI before enabling a fresh worker or confirming disable.
        self.publish(routing.latest.clone(), enabled).await;
        if enabled {
            let worker = if self.isolated {
                crate::roster::start_isolated(self.live.clone(), self.update.clone())
            } else {
                crate::roster::start(self.live.clone(), self.update.clone())
            };
            worker.send_replace(routing.latest.clone());
            routing.worker = Some(worker);
        }
    }
    async fn ingest(&self, value: Value) {
        // The published roster is copied only at post-game, not on every packet.
        let roster = if value["gameState"] == "DOTA_GAMERULES_STATE_POST_GAME" {
            self.live.read().await.clone()
        } else {
            Value::Null
        };
        let record = self.recorder.lock().unwrap().observe(&value, &roster);
        if let Some(record) = record {
            (self.finished)(record);
        }
        let mut routing = self.routing.lock().await;
        routing.latest = value.clone();
        #[cfg(any(target_os = "linux", windows))]
        if let Some(worker) = &routing.worker {
            worker.send_replace(value);
            return;
        }
        self.publish(value, false).await;
    }
}
#[derive(Clone)]
struct Receiver {
    token: String,
    control: Arc<Control>,
    diagnostics: Option<Arc<diagnostics::Diagnostics>>,
}
async fn receive(
    State(s): State<Receiver>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> StatusCode {
    if headers.contains_key("origin") {
        return StatusCode::FORBIDDEN;
    }
    if !headers
        .get("content-type")
        .and_then(|s| s.to_str().ok())
        .is_some_and(|s| s.starts_with("application/json"))
    {
        return StatusCode::UNSUPPORTED_MEDIA_TYPE;
    }
    let result = serde_json::from_slice(&body)
        .map_err(|_| "Invalid JSON".into())
        .and_then(|v| normalize(&v, &s.token).map(|normalized| (v, normalized)));
    match result {
        Ok((packet, v)) => {
            if let Some(diagnostics) = &s.diagnostics {
                if diagnostics.record(&packet, &v).await.is_err() {
                    eprintln!("GSI draft diagnostics: could not write local log");
                }
            }
            s.control.ingest(v).await;
            StatusCode::OK
        }
        Err(e) if e == "Unauthorized" => StatusCode::FORBIDDEN,
        Err(_) => StatusCode::BAD_REQUEST,
    }
}
pub async fn start(
    port: u16,
    token: String,
    live: Arc<RwLock<Value>>,
    reader_enabled: bool,
    directory: std::path::PathBuf,
    update: impl Fn(Value) + Send + Sync + 'static,
    finished: impl Fn(Value) + Send + Sync + 'static,
) -> Result<(u16, Arc<Control>)> {
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
        .await
        .map_err(|e| format!("GSI port is in use or unavailable: {e}"))?;
    let actual = listener.local_addr().map_err(|e| e.to_string())?.port();
    let update: Arc<dyn Fn(Value) + Send + Sync> = Arc::new(update);
    let control = Arc::new(Control::new(
        live,
        update,
        Box::new(finished),
        std::env::var_os("ANCIENT_TEST_DATA").is_some(),
    ));
    #[cfg(any(target_os = "linux", windows))]
    control.set_reader(reader_enabled).await;
    #[cfg(not(any(target_os = "linux", windows)))]
    let _ = reader_enabled;
    let router = Router::new()
        .route("/gsi", post(receive))
        .layer(DefaultBodyLimit::max(256 * 1024))
        .layer(tower_http::timeout::TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(5),
        ))
        .with_state(Receiver {
            token,
            control: control.clone(),
            diagnostics: diagnostics::Diagnostics::from_env(directory).map(Arc::new),
        });
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    Ok((actual, control))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn generated_config_requests_draft_but_normalization_does_not_expose_it() {
        assert!(config("fixture", 32123).contains("\"draft\" \"1\""));
        let raw = json!({"auth":{"token":"fixture"},"provider":{"appid":570},
            "draft":{"team2":{"pick0_id":1,"ban0_id":2}}});
        assert!(normalize(&raw, "fixture").unwrap().get("draft").is_none());
    }
    #[cfg(any(target_os = "linux", windows))]
    #[tokio::test]
    async fn reader_off_never_creates_worker_and_toggle_restores_raw_gsi() {
        let live = Arc::new(RwLock::new(Value::Null));
        let control = Control::new(live.clone(), Arc::new(|_| {}), Box::new(|_| {}), true);
        let raw = json!({"status":"connected","receivedAt":chrono::Utc::now().timestamp_millis(),
            "matchId":"123","mode":"player","gameState":"DOTA_GAMERULES_STATE_HERO_SELECTION",
            "players":[{"key":"self","team":"dire"}]});
        control.set_reader(false).await;
        control.ingest(raw.clone()).await;
        assert!(control.routing.lock().await.worker.is_none());
        assert_eq!(live.read().await["rosterStatus"], "disabled");
        for _ in 0..2 {
            control.set_reader(true).await;
            assert!(control.routing.lock().await.worker.is_some());
            tokio::time::timeout(Duration::from_secs(3), async {
                while live.read().await["draftStatus"] != "test-mode" {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap();
            control.set_reader(false).await;
            assert!(control.routing.lock().await.worker.is_none());
            assert!(live.read().await["draftStatus"].is_null());
            assert_eq!(live.read().await["players"], raw["players"]);
            assert_eq!(live.read().await["receivedAt"], raw["receivedAt"]);
            assert_eq!(live.read().await["rosterStatus"], "disabled");
        }
    }
    #[test]
    fn a_post_game_packet_becomes_one_match_record() {
        let raw = json!({"auth":{"token":"t"},"provider":{"appid":570},
            "map":{"matchid":"8012345678","clock_time":2135,"game_state":"DOTA_GAMERULES_STATE_POST_GAME","win_team":"radiant","radiant_score":38,"dire_score":21},
            "player":{"steamid":"76561198083722517","team_name":"radiant","team_slot":1,"kills":4,"deaths":6,"assists":21,
                "last_hits":61,"denies":4,"gpm":391,"xpm":512},
            "hero":{"id":5,"name":"npc_dota_hero_crystal_maiden"}});
        let live = normalize(&raw, "t").unwrap();
        assert_eq!(live["winTeam"], "radiant");
        let row = crate::journal::record(&live, "2026-10-23T20:00:00Z").unwrap();
        assert_eq!(
            (
                &row["accountId"],
                &row["hero_id"],
                &row["player_slot"],
                &row["radiant_win"]
            ),
            (&json!("123456789"), &json!(5), &json!(1), &json!(true))
        );
        assert_eq!(
            (&row["gold_per_min"], &row["assists"], &row["duration"]),
            (&json!(391), &json!(21), &json!(2135))
        );
        assert_eq!(
            (&row["radiant_score"], &row["dire_score"]),
            (&json!(38), &json!(21))
        );
        let mut unknown = raw.clone();
        unknown["map"]["win_team"] = json!("none");
        assert!(normalize(&unknown, "t").unwrap().get("winTeam").is_none());
    }
    #[tokio::test]
    async fn post_game_records_the_last_published_lanes_before_the_reader_clears_them() {
        let before = json!({"mode":"player","matchId":"8012345678",
            "gameState":"DOTA_GAMERULES_STATE_GAME_IN_PROGRESS",
            "players":[{"key":"self","team":"dire","teamSlot":2,"accountId":"123","heroId":74},
                {"key":"native.1","team":"dire","accountId":"55","heroId":14}],
            "draft":{"source":"native","matchId":"8012345678",
                "slots":[{"slot":8,"team":"dire","teamSlot":2}],
                "lanes":[{"slot":8,"team":"dire","flags":4}]}});
        let mut after = before.clone();
        after.as_object_mut().unwrap().remove("draft");
        after["players"].as_array_mut().unwrap().truncate(1);
        after["gameState"] = json!("DOTA_GAMERULES_STATE_POST_GAME");
        after["clock"] = json!(2400);
        after["winTeam"] = json!("dire");
        let records = Arc::new(std::sync::Mutex::new(Vec::new()));
        let saved = records.clone();
        let live = Arc::new(RwLock::new(before));
        let control = Control::new(
            live.clone(),
            Arc::new(|_| {}),
            Box::new(move |row| {
                saved.lock().unwrap().push(row);
            }),
            true,
        );
        let mut incomplete = after.clone();
        incomplete["winTeam"] = json!("none");
        control.ingest(incomplete).await;
        assert!(live.read().await["draft"].is_null());
        assert!(records.lock().unwrap().is_empty());
        control.ingest(after.clone()).await;
        assert!(live.read().await["draft"].is_null());
        control.ingest(after.clone()).await;
        let records = records.lock().unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0]["queue_position"], 2);
        assert_eq!(records[0]["allies"], json!([{"id":55,"hero":14}]));
    }
    #[test]
    fn optional_self_team_slot() {
        let mut v = json!({"auth":{"token":"test"},"provider":{"appid":570},"player":{"team_name":"dire","team_slot":3}});
        let out = normalize(&v, "test").unwrap();
        assert_eq!(out["selfTeamSlot"], 3);
        assert_eq!(out["players"][0]["teamSlot"], 3);
        for slot in [json!(-1), json!(5), json!(1.5), json!("2"), Value::Null] {
            v["player"]["team_slot"] = slot;
            assert!(normalize(&v, "test").unwrap().get("selfTeamSlot").is_none());
        }
        v["player"] = json!({"team2":{"player0":{"team_slot":4}}});
        let out = normalize(&v, "test").unwrap();
        assert_eq!(out["players"][0]["teamSlot"], 4);
        assert!(out.get("selfTeamSlot").is_none());
    }
    #[test]
    fn spectator_and_identity() {
        let v = json!({"auth":{"token":"test"},"provider":{"appid":570},"map":{"matchid":123},"player":{"team2":{"player0":{"steamid":"76561198083722517","name":"Test"}}},"hero":{"team2":{"player0":{"id":55,"name":"npc_dota_hero_dark_seer"}}}});
        let out = normalize(&v, "test").unwrap();
        assert_eq!(out["players"][0]["accountId"], "123456789");
        assert_eq!(out["mode"], "spectator");
        assert!(normalize(&v, "wrong").is_err());
    }
    #[test]
    fn sentinel_never_becomes_profile() {
        assert!(stats(&json!({"steamid":"0"}), &json!({}))
            .get("accountId")
            .is_none());
    }
}
