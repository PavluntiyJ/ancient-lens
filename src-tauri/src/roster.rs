//! Read-only roster enrichment from the running game on Linux and Windows. GSI remains the
//! authority for match and local player.
// ELF and PE discovery are file parsing, built and tested everywhere; each is used by one system.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
mod elf;
#[cfg(target_os = "linux")]
pub(crate) mod linux;
#[cfg_attr(not(windows), allow(dead_code))]
mod pe;
mod picks;
mod source2;
#[cfg(windows)]
mod windows;
#[cfg(target_os = "linux")]
use linux as native;
#[cfg(windows)]
use windows as native;

use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{watch, RwLock};

#[derive(Clone, Debug, PartialEq)]
struct Context {
    match_id: u64,
    account_id: u32,
    team: u8,
    hero: u32,
    phase: String,
    /// Watching a match in the client: GSI reports player mode without any player, so the
    /// roster cannot be checked against the local player (account, team and hero are 0).
    watching: bool,
}
impl Context {
    fn fresh(v: &Value, now_ms: i64) -> Option<Self> {
        let age = now_ms.checked_sub(v["receivedAt"].as_i64()?)?;
        (0..15_000)
            .contains(&age)
            .then(|| Self::from_gsi(v))
            .flatten()
    }

    fn from_gsi(v: &Value) -> Option<Self> {
        if v["mode"] != "player"
            || !matches!(
                v["gameState"].as_str()?,
                "DOTA_GAMERULES_STATE_STRATEGY_TIME"
                    | "DOTA_GAMERULES_STATE_TEAM_SHOWCASE"
                    | "DOTA_GAMERULES_STATE_PRE_GAME"
                    | "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS"
            )
        {
            return None;
        }
        let players = v["players"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default();
        let match_id = v["matchId"].as_str()?.parse().ok().filter(|id| *id > 0)?;
        let Some(own) = players.iter().find(|p| p["key"] == "self") else {
            return players.is_empty().then(|| Self {
                match_id,
                account_id: 0,
                team: 0,
                hero: 0,
                phase: v["gameState"].as_str().unwrap_or_default().into(),
                watching: true,
            });
        };
        let account_id = own["accountId"]
            .as_str()?
            .parse()
            .ok()
            .filter(|id| *id > 0)?;
        let team = match own["team"].as_str()? {
            "radiant" => 2,
            "dire" => 3,
            _ => return None,
        };
        let hero = u32::try_from(own["heroId"].as_u64()?)
            .ok()
            .filter(|id| *id > 0)?;
        Some(Self {
            match_id,
            account_id,
            team,
            hero,
            phase: v["gameState"].as_str()?.into(),
            watching: false,
        })
    }
}

/// Discovery may outlive the GSI packet that started it. Apply its result only
/// to a still-fresh, matching context, preserving the latest local-player stats.
fn finish_poll(
    mut current: Value,
    requested: Option<&Context>,
    result: std::result::Result<Snapshot, &'static str>,
    now_ms: i64,
) -> Value {
    if requested.is_none() || Context::fresh(&current, now_ms).as_ref() != requested {
        return current;
    }
    match result {
        Ok(snapshot) => current = snapshot.merge(current),
        Err(status) => current["rosterStatus"] = json!(status),
    }
    current
}

/// Keep the confirmed roster of the match through a failed read, as `picks::carry` keeps
/// the draft. Memory reaches the next phase about a second before GSI, so the last
/// in-game packet would otherwise drop nine players, and the post-game view freezes it.
/// Only the same GSI match inherits it; `merge` still checks the local player.
fn hold(
    result: std::result::Result<Snapshot, &'static str>,
    confirmed: &mut Option<Snapshot>,
    ctx: Option<&Context>,
) -> std::result::Result<Snapshot, &'static str> {
    match result {
        Ok(snapshot) => {
            *confirmed = Some(snapshot.clone());
            Ok(snapshot)
        }
        Err(status) if picks::TRANSIENT.contains(&status) => confirmed
            .as_ref()
            .filter(|s| ctx.is_some_and(|ctx| s.match_id == ctx.match_id))
            .cloned()
            .ok_or(status),
        Err(status) => Err(status),
    }
}

#[derive(Clone, Debug)]
struct Player {
    index: u32,
    account_id: u32,
    team: u8,
    hero: u32,
    name: String,
    rank_tier: Option<i32>,
}
#[derive(Clone, Debug)]
struct Snapshot {
    match_id: u64,
    players: Vec<Player>,
}
impl Snapshot {
    fn matches(&self, ctx: &Context) -> bool {
        self.match_id == ctx.match_id
            && self.players.len() == 10
            && self
                .players
                .iter()
                .map(|p| p.account_id)
                .collect::<BTreeSet<_>>()
                .len()
                == 10
            && self
                .players
                .iter()
                .map(|p| p.index)
                .collect::<BTreeSet<_>>()
                .len()
                == 10
            && [2, 3]
                .iter()
                .all(|team| self.players.iter().filter(|p| p.team == *team).count() == 5)
            && self
                .players
                .iter()
                .all(|p| p.account_id != 0 && p.index < 64 && p.hero < 2048)
            && (ctx.watching
                || self.players.iter().any(|p| {
                    p.account_id == ctx.account_id && p.team == ctx.team && p.hero == ctx.hero
                }))
    }
    fn merge(&self, mut v: Value) -> Value {
        let Some(ctx) = Context::from_gsi(&v) else {
            return v;
        };
        if !self.matches(&ctx) {
            return v;
        }
        let own = v["players"]
            .as_array()
            .and_then(|players| players.iter().find(|p| p["key"] == "self"))
            .cloned();
        let mut players = self.players.clone();
        players.sort_by_key(|p| (p.team, p.index));
        v["players"] = json!(players.iter().map(|p| {
            let mut row = if let Some(own) = own.as_ref().filter(|_| p.account_id == ctx.account_id) { own.clone() } else {
                json!({"key": format!("native.{}", p.index), "accountId": p.account_id.to_string(),
                    "team": if p.team == 2 { "radiant" } else { "dire" }, "heroId": p.hero, "name": p.name})
            };
            if let Some(tier) = p.rank_tier { row["rankTier"] = json!(tier); }
            row
        }).collect::<Vec<_>>());
        v["rosterStatus"] = json!("ready");
        v["rosterSource"] = json!("native");
        v
    }
}

/// The HTTP handler only sends GSI updates. Slow discovery cannot block its response,
/// queue old snapshots, or overwrite a newer match. At most one native read runs at a time.
pub(crate) struct Worker {
    input: watch::Sender<Value>,
    task: tokio::task::JoinHandle<()>,
}
impl Worker {
    pub fn send_replace(&self, value: Value) {
        self.input.send_replace(value);
    }
    pub async fn stop(self) {
        drop(self.input);
        let _ = self.task.await;
    }
}

pub(crate) fn start_isolated(
    live: Arc<RwLock<Value>>,
    update: Arc<dyn Fn(Value) + Send + Sync>,
) -> Worker {
    start_with_reader(live, update, |_, _| (Err("test-mode"), Err("test-mode")))
}

pub(crate) fn start(live: Arc<RwLock<Value>>, update: Arc<dyn Fn(Value) + Send + Sync>) -> Worker {
    let mut provider = native::Provider::default();
    start_with_reader(live, update, move |context, draft_context| {
        let draft = draft_context.map_or(Err("waiting"), |ctx| provider.poll_draft(ctx));
        let roster = match context {
            Some(ctx) => provider.poll(ctx),
            None => {
                if draft_context.is_none() {
                    provider.clear();
                }
                Err("waiting")
            }
        };
        (roster, draft)
    })
}

type ReadResult = (
    Result<Snapshot, &'static str>,
    Result<picks::Snapshot, &'static str>,
);
fn start_with_reader<F>(
    live: Arc<RwLock<Value>>,
    update: Arc<dyn Fn(Value) + Send + Sync>,
    mut read: F,
) -> Worker
where
    F: FnMut(Option<&Context>, Option<&picks::Context>) -> ReadResult + Send + 'static,
{
    let (tx, mut rx) = watch::channel(Value::Null);
    let debug = std::env::var_os("ANCIENT_DEBUG")
        .or_else(|| std::env::var_os("ANCIENT_ROSTER_DEBUG"))
        .is_some();
    let task = tokio::spawn(async move {
        let mut last_diagnostic = None;
        let mut last_notes = Vec::new();
        let mut attempts: u64 = 0;
        let mut successes: u64 = 0;
        let mut retries: u64 = 0;
        let mut incomplete_reads: u64 = 0;
        let mut mismatch_reads: u64 = 0;
        // No match to read yet (menu, loading, after the game): not a failure.
        let mut waiting_reads: u64 = 0;
        let mut error_reads: u64 = 0;
        // A read takes a few milliseconds. Hovers and picks change several times a second
        // during the draft, so it is read every tick; the rest of the match once a second.
        let mut interval = tokio::time::interval(Duration::from_millis(250));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut last_read: Option<Instant> = None;
        let mut confirmed = None;
        loop {
            interval.tick().await;
            if rx.has_changed().is_err() {
                break;
            }
            let initial = rx.borrow_and_update().clone();
            if initial.is_null() {
                continue;
            }
            let drafting = matches!(
                initial["gameState"].as_str(),
                Some("DOTA_GAMERULES_STATE_HERO_SELECTION" | "DOTA_GAMERULES_STATE_STRATEGY_TIME")
            );
            if !drafting && last_read.is_some_and(|at| at.elapsed() < Duration::from_millis(950)) {
                continue;
            }
            last_read = Some(Instant::now());
            // Never keep polling process memory after GSI goes stale or the game closes.
            let context = Context::fresh(&initial, chrono::Utc::now().timestamp_millis());
            let requested = context.clone();
            let draft_context =
                picks::Context::fresh(&initial, chrono::Utc::now().timestamp_millis());
            let requested_draft = draft_context.clone();
            let attempt_started = Instant::now();
            let work = tokio::task::spawn_blocking(move || {
                let (result, draft_result) = read(context.as_ref(), draft_context.as_ref());
                (read, result, draft_result)
            })
            .await;
            let Ok((returned, result, draft_result)) = work else {
                break;
            };
            read = returned;
            attempts += 1;
            let attempt_ms = attempt_started.elapsed().as_millis();
            match &result {
                Ok(_) => successes += 1,
                Err("retrying") => retries += 1,
                Err("match-mismatch") => mismatch_reads += 1,
                Err("incomplete") => incomplete_reads += 1,
                Err("waiting") => waiting_reads += 1,
                Err(_) => error_reads += 1,
            }
            if debug {
                eprintln!(
                    "{} Native roster attempt #{}: roster={} draft={} {}ms counts={{ok:{},waiting:{},retry:{},incomplete:{},mismatch:{},error:{},total:{}}}",
                    chrono::Local::now().format("%H:%M:%S%.3f"),
                    attempts,
                    result.as_ref().map(|_| "ok").unwrap_or_else(|e| *e),
                    draft_result.as_ref().map(|_| "ok").unwrap_or_else(|e| *e),
                    attempt_ms,
                    successes,
                    waiting_reads,
                    retries,
                    incomplete_reads,
                    mismatch_reads,
                    error_reads,
                    attempts
                );
            }
            let mut published = live.write().await;
            // Dropping the sender revokes publication, including an in-flight read.
            if rx.has_changed().is_err() {
                break;
            }
            let current = finish_poll(
                rx.borrow().clone(),
                requested.as_ref(),
                hold(result, &mut confirmed, requested.as_ref()),
                chrono::Utc::now().timestamp_millis(),
            );
            let current = picks::finish_poll(
                current,
                requested_draft.as_ref(),
                draft_result,
                chrono::Utc::now().timestamp_millis(),
            );
            let current = picks::carry(current, &published, chrono::Utc::now().timestamp_millis());
            let diagnostic = (
                current["matchId"].as_str().unwrap_or("0").to_string(),
                current["rosterStatus"]
                    .as_str()
                    .unwrap_or("waiting")
                    .to_string(),
                current["players"].as_array().map_or(0, Vec::len),
                current["draftStatus"]
                    .as_str()
                    .unwrap_or("waiting")
                    .to_string(),
                current["draft"]["picks"].as_array().map_or(0, Vec::len),
                current["gameState"]
                    .as_str()
                    .unwrap_or("unknown")
                    .trim_start_matches("DOTA_GAMERULES_STATE_")
                    .to_string(),
                // Hero IDs, slots, sides and lane flags only; the draft carries no identities.
                // observedAt alone changes every tick, so it does not make a new line.
                {
                    let mut draft = current["draft"].clone();
                    if let Some(draft) = draft.as_object_mut() {
                        draft.remove("observedAt");
                    }
                    draft.to_string()
                },
                // Why a draft read was rejected, with the GSI side of the comparison.
                match (picks::take_incomplete_reason(), &requested_draft) {
                    (Some(reason), Some(ctx))
                        if current["draftStatus"] == "incomplete"
                            || current["draft"]["held"] == "incomplete" =>
                    {
                        format!(
                            " reason=\"{reason}\" gsi={{phase:{},team:{},hero:{}}}",
                            ctx.phase.trim_start_matches("DOTA_GAMERULES_STATE_"),
                            ctx.team,
                            ctx.hero.map_or("none".to_string(), |h| h.to_string())
                        )
                    }
                    _ => String::new(),
                },
            );
            let notes = picks::take_notes();
            if !notes.is_empty() && notes != last_notes {
                eprintln!(
                    "{} Native roster note: {}",
                    chrono::Local::now().format("%H:%M:%S%.3f"),
                    notes.join("; ")
                );
            }
            last_notes = notes;
            if last_diagnostic.as_ref() != Some(&diagnostic) {
                // Never log player IDs, names, GSI auth or API keys.
                eprintln!(
                    "{} Native roster: state={} status={} players={}/10 draft={}{} picks={}/10 data={} counts={{ok:{},waiting:{},retry:{},incomplete:{},mismatch:{},error:{},total:{}}}",
                    chrono::Local::now().format("%H:%M:%S%.3f"),
                    diagnostic.5,
                    diagnostic.1,
                    diagnostic.2,
                    diagnostic.3,
                    diagnostic.7,
                    diagnostic.4,
                    diagnostic.6,
                    successes,
                    waiting_reads,
                    retries,
                    incomplete_reads,
                    mismatch_reads,
                    error_reads,
                    attempts
                );
                last_diagnostic = Some(diagnostic);
            }
            // receivedAt belongs to GSI; polling must not pretend the game is still connected.
            if *published != current {
                *published = current.clone();
                update(current);
            }
        }
    });
    Worker { input: tx, task }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn stopping_worker_waits_for_read_and_discards_its_result() {
        let live = Arc::new(RwLock::new(Value::Null));
        let (began, started) = tokio::sync::oneshot::channel();
        let (release, blocked) = tokio::sync::oneshot::channel();
        let mut gates = Some((began, blocked));
        let worker = start_with_reader(
            live.clone(),
            Arc::new(|_| panic!("stopped worker published")),
            move |_, _| {
                let (began, blocked) = gates.take().unwrap();
                let _ = began.send(());
                blocked.blocking_recv().unwrap();
                (Ok(snapshot()), Err("waiting"))
            },
        );
        let mut input = gsi();
        input["receivedAt"] = json!(chrono::Utc::now().timestamp_millis());
        worker.send_replace(input);
        started.await.unwrap();
        let mut monitor = worker.input.subscribe();
        monitor.borrow_and_update();
        let stopping = tokio::spawn(worker.stop());
        assert!(monitor.changed().await.is_err());
        assert!(!stopping.is_finished());
        release.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(3), stopping)
            .await
            .unwrap()
            .unwrap();
        assert!(live.read().await.is_null());
    }
    fn gsi() -> Value {
        json!({"mode":"player", "matchId":"123", "gameState":"DOTA_GAMERULES_STATE_GAME_IN_PROGRESS",
            "players":[{"key":"self", "accountId":"6", "team":"dire", "heroId":20, "kills":7, "name":"Local"}]})
    }
    #[test]
    fn watching_a_match_reads_the_roster_without_a_local_player() {
        // Watching live in the client: player mode with a match but no player at all.
        let mut watching = gsi();
        watching["players"] = json!([]);
        let ctx = Context::from_gsi(&watching).unwrap();
        assert!(ctx.watching && ctx.match_id == 123);
        let merged = snapshot().merge(watching.clone());
        assert_eq!(merged["rosterStatus"], "ready");
        let players = merged["players"].as_array().unwrap();
        assert_eq!(players.len(), 10);
        assert!(players.iter().all(|p| p["key"] != "self"));
        // A packet with players but none of them local is not a watched match.
        watching["players"] = json!([{"key":"other", "accountId":"6", "team":"dire", "heroId":20}]);
        assert!(Context::from_gsi(&watching).is_none());
        // In an own match the local player is still required.
        let mut own = snapshot();
        own.players.retain(|p| p.account_id != 6);
        assert!(own.merge(gsi())["rosterStatus"].is_null());
    }
    fn snapshot() -> Snapshot {
        Snapshot {
            match_id: 123,
            players: (0..10)
                .map(|i| Player {
                    index: i,
                    account_id: i + 1,
                    team: if i < 5 { 2 } else { 3 },
                    hero: 20,
                    name: "Player".into(),
                    rank_tier: None,
                })
                .collect(),
        }
    }
    #[test]
    fn merges_ten_and_preserves_local_gsi_stats() {
        let out = snapshot().merge(gsi());
        assert_eq!(out["players"].as_array().unwrap().len(), 10);
        assert_eq!(out["players"][5]["key"], "self");
        assert_eq!(out["players"][5]["kills"], 7);
        assert_eq!(out["players"][5]["name"], "Local");
        assert_eq!(out["mode"], "player");
        assert_eq!(out["rosterSource"], "native");
    }
    #[test]
    fn rejects_stale_wrong_self_duplicate_and_partial_rosters() {
        let mut cases = vec![];
        let mut s = snapshot();
        s.match_id += 1;
        cases.push(s);
        let mut s = snapshot();
        s.players[5].hero = 1;
        cases.push(s);
        let mut s = snapshot();
        s.players[5].team = 2;
        cases.push(s);
        let mut s = snapshot();
        s.players[0].account_id = 2;
        cases.push(s);
        let mut s = snapshot();
        s.players[0].index = 1;
        cases.push(s);
        let mut s = snapshot();
        s.players.pop();
        cases.push(s);
        for s in cases {
            assert_eq!(s.merge(gsi()), gsi());
        }
    }
    #[test]
    fn selection_spectator_and_new_match_are_not_enriched() {
        for phase in [
            "DOTA_GAMERULES_STATE_HERO_SELECTION",
            "DOTA_GAMERULES_STATE_POST_GAME",
            "unknown",
        ] {
            let mut v = gsi();
            v["gameState"] = json!(phase);
            assert_eq!(snapshot().merge(v.clone()), v);
        }
        let mut v = gsi();
        v["mode"] = json!("spectator");
        assert_eq!(snapshot().merge(v.clone()), v);
        let mut v = gsi();
        v["matchId"] = json!("124");
        assert_eq!(snapshot().merge(v.clone()), v);
    }

    #[test]
    fn slow_poll_cannot_publish_after_gsi_expires_or_changes_match() {
        let mut initial = gsi();
        initial["receivedAt"] = json!(1000);
        let requested = Context::fresh(&initial, 15_999).unwrap();
        // The read began with a valid packet; it completed after the timeout.
        assert_eq!(
            finish_poll(initial.clone(), Some(&requested), Ok(snapshot()), 16_000),
            initial
        );
        assert_eq!(
            finish_poll(initial.clone(), Some(&requested), Err("permission"), 16_000),
            initial
        );
        let mut next = initial.clone();
        next["receivedAt"] = json!(16_000);
        next["matchId"] = json!("124");
        assert_eq!(
            finish_poll(next.clone(), Some(&requested), Ok(snapshot()), 16_001),
            next
        );
        next["mode"] = json!("spectator");
        assert_eq!(
            finish_poll(next.clone(), Some(&requested), Ok(snapshot()), 16_001),
            next
        );
        // A backwards wall-clock jump must not make a packet fresh indefinitely.
        assert!(Context::fresh(&initial, 999).is_none());
    }

    #[test]
    fn poll_uses_newest_local_stats_when_context_still_matches() {
        let requested = Context::from_gsi(&gsi()).unwrap();
        let mut latest = gsi();
        latest["receivedAt"] = json!(20_000);
        latest["players"][0]["kills"] = json!(8);
        let out = finish_poll(latest, Some(&requested), Ok(snapshot()), 20_001);
        assert_eq!(out["players"].as_array().unwrap().len(), 10);
        assert_eq!(out["players"][5]["kills"], 8);
        assert_eq!(out["receivedAt"], 20_000);
    }
    #[test]
    fn confirmed_roster_survives_transient_failures_of_the_same_match() {
        let mut packet = gsi();
        packet["receivedAt"] = json!(1000);
        let ctx = Context::fresh(&packet, 1001).unwrap();
        let mut confirmed = None;
        assert!(hold(Ok(snapshot()), &mut confirmed, Some(&ctx)).is_ok());
        // Memory reaches post-game a second before GSI does.
        for status in ["incomplete", "match-mismatch", "retrying", "unavailable"] {
            let held = hold(Err(status), &mut confirmed, Some(&ctx));
            let out = finish_poll(packet.clone(), Some(&ctx), held, 1001);
            assert_eq!(out["players"].as_array().unwrap().len(), 10);
            assert_eq!(out["players"][5]["kills"], 7);
            assert_eq!(out["rosterStatus"], "ready");
        }
        // A real failure is shown, and another match never inherits the roster.
        assert_eq!(
            hold(Err("permission"), &mut confirmed, Some(&ctx)).unwrap_err(),
            "permission"
        );
        let mut next = gsi();
        next["matchId"] = json!("124");
        let other = Context::from_gsi(&next).unwrap();
        assert_eq!(
            hold(Err("match-mismatch"), &mut confirmed, Some(&other)).unwrap_err(),
            "match-mismatch"
        );
    }
    #[tokio::test]
    async fn worker_delivers_draft_before_identity_and_clears_it_in_menu() {
        let live = Arc::new(RwLock::new(Value::Null));
        let (events, mut updates) = tokio::sync::mpsc::unbounded_channel();
        let sender = start_with_reader(
            live,
            Arc::new(move |v| {
                let _ = events.send(v);
            }),
            |roster, draft| {
                let identity = roster.map_or(Err("waiting"), |_| Ok(snapshot()));
                let draft = draft.map_or(Err("waiting"), |ctx| {
                    Ok(picks::Snapshot {
                        match_id: ctx.match_id,
                        phase: picks::phase_number(&ctx.phase).unwrap(),
                        picks: vec![
                            picks::Pick {
                                slot: 0,
                                team: 2,
                                hero: 1,
                            },
                            picks::Pick {
                                slot: 5,
                                team: 3,
                                hero: 20,
                            },
                        ],
                        hovers: vec![],
                        lanes: vec![],
                        slots: vec![],
                        bans: vec![],
                    })
                });
                (identity, draft)
            },
        );
        let mut input = gsi();
        input["gameState"] = json!("DOTA_GAMERULES_STATE_HERO_SELECTION");
        input["receivedAt"] = json!(chrono::Utc::now().timestamp_millis());
        sender.send_replace(input.clone());
        let early = tokio::time::timeout(Duration::from_secs(3), updates.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(early["draft"]["picks"].as_array().unwrap().len(), 2);
        assert_eq!(early["players"].as_array().unwrap().len(), 1);
        input["gameState"] = json!("DOTA_GAMERULES_STATE_STRATEGY_TIME");
        sender.send_replace(input.clone());
        let full = tokio::time::timeout(Duration::from_secs(3), updates.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(full["players"].as_array().unwrap().len(), 10);
        assert_eq!(full["draft"]["picks"].as_array().unwrap().len(), 2);
        input["gameState"] = json!("DOTA_GAMERULES_STATE_INIT");
        input["matchId"] = json!("0");
        sender.send_replace(input);
        let menu = tokio::time::timeout(Duration::from_secs(3), updates.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(menu["draft"].is_null());
        assert!(menu["rosterSource"].is_null());
        drop(sender);
    }
    async fn reads_per_second(phase: &str) -> usize {
        let reads = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = reads.clone();
        let worker = start_with_reader(
            Arc::new(RwLock::new(Value::Null)),
            Arc::new(|_| {}),
            move |_, _| {
                counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                (Err("waiting"), Err("waiting"))
            },
        );
        let mut input = gsi();
        input["gameState"] = json!(phase);
        input["receivedAt"] = json!(chrono::Utc::now().timestamp_millis());
        worker.send_replace(input);
        tokio::time::sleep(Duration::from_millis(1100)).await;
        worker.stop().await;
        reads.load(std::sync::atomic::Ordering::SeqCst)
    }
    #[tokio::test]
    async fn worker_reads_the_draft_several_times_a_second_and_the_game_once() {
        for phase in [
            "DOTA_GAMERULES_STATE_HERO_SELECTION",
            "DOTA_GAMERULES_STATE_STRATEGY_TIME",
        ] {
            assert!(reads_per_second(phase).await >= 4, "{phase}");
        }
        assert!(reads_per_second("DOTA_GAMERULES_STATE_GAME_IN_PROGRESS").await <= 2);
    }
}
