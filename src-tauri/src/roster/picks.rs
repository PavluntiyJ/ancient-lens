//! Draft-only contract: no names or account IDs and no dependency on a full roster.
use serde_json::{json, Value};
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq)]
pub(super) struct Context {
    pub match_id: u64,
    pub phase: String,
    pub team: u8,
    pub hero: Option<u32>,
}
impl Context {
    pub fn fresh(v: &Value, now_ms: i64) -> Option<Self> {
        let age = now_ms.checked_sub(v["receivedAt"].as_i64()?)?;
        if !(0..15_000).contains(&age) || v["mode"] != "player" {
            return None;
        }
        let phase = v["gameState"].as_str()?;
        phase_number(phase)?;
        let own = v["players"]
            .as_array()?
            .iter()
            .find(|p| p["key"] == "self")?;
        let team = match own["team"].as_str()? {
            "radiant" => 2,
            "dire" => 3,
            _ => return None,
        };
        Some(Self {
            match_id: v["matchId"].as_str()?.parse().ok().filter(|id| *id > 0)?,
            phase: phase.into(),
            team,
            hero: own["heroId"]
                .as_u64()
                .and_then(|id| u32::try_from(id).ok())
                .filter(|id| *id > 0 && *id < 1001),
        })
    }
}
pub(super) fn phase_number(phase: &str) -> Option<u32> {
    Some(match phase {
        // Loading: no picks yet, but bans and role-queue roles are already set.
        "DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD" => 1,
        "DOTA_GAMERULES_STATE_HERO_SELECTION" => 2,
        "DOTA_GAMERULES_STATE_STRATEGY_TIME" => 3,
        "DOTA_GAMERULES_STATE_PRE_GAME" => 4,
        "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS" => 5,
        "DOTA_GAMERULES_STATE_TEAM_SHOWCASE" => 8,
        _ => return None,
    })
}
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Pick {
    pub slot: u32,
    pub team: u8,
    pub hero: u32,
}
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Lane {
    pub slot: u32,
    pub team: u8,
    /// ELaneSelectionFlags; combinations remain ambiguous, not a guessed position.
    pub flags: u8,
}
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Slot {
    pub slot: u32,
    pub team: u8,
    pub team_slot: i32,
}
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Snapshot {
    pub match_id: u64,
    pub phase: u32,
    pub picks: Vec<Pick>,
    /// All Pick/Turbo bans carry no team.
    pub bans: Vec<u32>,
    pub hovers: Vec<Pick>,
    pub lanes: Vec<Lane>,
    pub slots: Vec<Slot>,
}
pub(super) const MAX_BANS: usize = 24;
/// Why the latest draft read was rejected as "incomplete". Diagnostics only: the
/// status string the UI sees stays the same.
static INCOMPLETE_REASON: std::sync::Mutex<Option<&'static str>> = std::sync::Mutex::new(None);
pub(super) fn incomplete(reason: &'static str) -> &'static str {
    if let Ok(mut slot) = INCOMPLETE_REASON.lock() {
        *slot = Some(reason);
    }
    "incomplete"
}
/// Records `reason` only when `error` is the generic "incomplete".
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(super) fn tag(error: &'static str, reason: &'static str) -> &'static str {
    if error == "incomplete" {
        incomplete(reason)
    } else {
        error
    }
}
pub(super) fn take_incomplete_reason() -> Option<&'static str> {
    INCOMPLETE_REASON.lock().ok()?.take()
}
/// Values the reader tolerated instead of rejecting the draft (hero IDs and raw
/// numbers only), so the log shows what the game actually held.
static NOTES: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(super) fn note(detail: String) {
    if let Ok(mut notes) = NOTES.lock() {
        if !notes.contains(&detail) && notes.len() < 16 {
            notes.push(detail);
        }
    }
}
pub(super) fn take_notes() -> Vec<String> {
    NOTES
        .lock()
        .map(|mut notes| std::mem::take(&mut *notes))
        .unwrap_or_default()
}
impl Snapshot {
    pub fn matches(&self, ctx: &Context) -> bool {
        self.mismatch(ctx).is_none()
    }
    /// The first failed consistency check, named for the diagnostic log.
    pub fn mismatch(&self, ctx: &Context) -> Option<&'static str> {
        fn unique<T: Ord>(items: impl Iterator<Item = T>, len: usize) -> bool {
            items.collect::<BTreeSet<_>>().len() == len
        }
        let per_team = |rows: &[Pick]| {
            [2, 3]
                .iter()
                .all(|team| rows.iter().filter(|p| p.team == *team).count() <= 5)
        };
        let checks: [(&'static str, bool); 18] = [
            ("match id", self.match_id == ctx.match_id),
            ("phase", Some(self.phase) == phase_number(&ctx.phase)),
            ("pick count", self.picks.len() <= 10),
            (
                "pick values",
                self.picks.iter().all(|p| {
                    p.slot < 64 && [2, 3].contains(&p.team) && (1..=1000).contains(&p.hero)
                }),
            ),
            (
                "pick slots unique",
                unique(self.picks.iter().map(|p| p.slot), self.picks.len()),
            ),
            (
                "pick heroes unique",
                unique(self.picks.iter().map(|p| p.hero), self.picks.len()),
            ),
            ("picks per team", per_team(&self.picks)),
            (
                "ban values",
                self.bans.len() <= MAX_BANS
                    && self.bans.iter().all(|h| (1..=1000).contains(h))
                    && unique(self.bans.iter(), self.bans.len()),
            ),
            (
                "banned hero picked",
                self.bans
                    .iter()
                    .all(|h| self.picks.iter().all(|p| p.hero != *h)),
            ),
            (
                "hover values",
                self.hovers.len() <= 10
                    && self.hovers.iter().all(|p| {
                        p.slot < 64
                            && [2, 3].contains(&p.team)
                            && (1..=1000).contains(&p.hero)
                            && !self.picks.iter().any(|pick| pick.hero == p.hero)
                    }),
            ),
            (
                "hover slots unique",
                unique(self.hovers.iter().map(|p| p.slot), self.hovers.len()),
            ),
            ("hovers per team", per_team(&self.hovers)),
            (
                "lane values",
                self.lanes.len() <= 10
                    && self.lanes.iter().all(|p| {
                        p.slot < 64 && [2, 3].contains(&p.team) && p.flags > 0 && p.flags & !31 == 0
                    }),
            ),
            (
                "lane slots unique",
                unique(self.lanes.iter().map(|p| p.slot), self.lanes.len()),
            ),
            (
                "slot values",
                self.slots.len() <= 10
                    && self.slots.iter().all(|p| {
                        p.slot < 64 && [2, 3].contains(&p.team) && (-1..=4).contains(&p.team_slot)
                    }),
            ),
            (
                "slot slots unique",
                unique(self.slots.iter().map(|p| p.slot), self.slots.len()),
            ),
            (
                "slots per team",
                [2, 3]
                    .iter()
                    .all(|team| self.slots.iter().filter(|p| p.team == *team).count() <= 5),
            ),
            (
                // GSI shows a locked hero before a blind round reveals it in memory,
                // so the cross-check starts once hero selection is over.
                "own GSI hero not picked",
                ctx.phase == "DOTA_GAMERULES_STATE_HERO_SELECTION"
                    || ctx.hero.is_none_or(|hero| {
                        self.picks
                            .iter()
                            .any(|p| p.team == ctx.team && p.hero == hero)
                    }),
            ),
        ];
        checks.iter().find(|(_, ok)| !ok).map(|(name, _)| *name)
    }
}
pub(super) fn finish_poll(
    mut current: Value,
    requested: Option<&Context>,
    result: Result<Snapshot, &'static str>,
    now_ms: i64,
) -> Value {
    let Some(requested) = requested else {
        return current;
    };
    match Context::fresh(&current, now_ms) {
        Some(now) if &now == requested => {}
        // GSI moved on during the read, e.g. to Strategy Time: the result belongs to the old
        // phase, but the match goes on, so `carry` keeps its draft until the next read.
        Some(now) if now.match_id == requested.match_id => {
            current["draftStatus"] = json!("retrying");
            return current;
        }
        Some(_) => return current,
        None => return current,
    }
    let requested = Some(requested);
    match result {
        Ok(snapshot) if snapshot.matches(requested.unwrap()) => {
            current["draftStatus"] = json!("ready");
            current["draft"] = json!({
                "matchId": snapshot.match_id.to_string(), "gameState": requested.unwrap().phase,
                "source": "native", "observedAt": now_ms,
                "picks": snapshot.picks.iter().map(|p| json!({
                    "slot":p.slot, "heroId":p.hero, "team":if p.team==2 {"radiant"} else {"dire"}
                })).collect::<Vec<_>>(),
                "hovers": snapshot.hovers.iter().map(|p| json!({
                    "slot":p.slot, "heroId":p.hero, "team":if p.team==2 {"radiant"} else {"dire"}
                })).collect::<Vec<_>>(),
                "lanes": snapshot.lanes.iter().map(|p| json!({
                    "slot":p.slot, "flags":p.flags, "team":if p.team==2 {"radiant"} else {"dire"}
                })).collect::<Vec<_>>(),
                "slots": snapshot.slots.iter().map(|p| json!({
                    "slot":p.slot, "teamSlot":p.team_slot, "team":if p.team==2 {"radiant"} else {"dire"}
                })).collect::<Vec<_>>(),
                "bans": snapshot.bans
            });
        }
        Ok(snapshot) => {
            if let Some(reason) = snapshot.mismatch(requested.unwrap()) {
                incomplete(reason);
            }
            current["draftStatus"] = json!("incomplete");
        }
        Err(status) => current["draftStatus"] = json!(status),
    }
    current
}

/// Statuses of a single failed read while the match is still running: a blind pick
/// round, a phase switch seen in memory before GSI, an unstable or reset read.
pub(super) const TRANSIENT: [&str; 4] = ["incomplete", "match-mismatch", "retrying", "unavailable"];

/// Keep the draft for the match: once read, picks,
/// bans, lanes and slots do not vanish because one later read failed. The last
/// confirmed draft is republished with `held` set to the failed status; hovers are
/// dropped because they go stale within seconds. A new match id never inherits.
pub(super) fn carry(mut current: Value, previous: &Value, now_ms: i64) -> Value {
    let kept = &previous["draft"];
    let same_match = kept["source"] == "native"
        && kept["matchId"].is_string()
        && kept["matchId"] == current["matchId"]
        && current["mode"] == "player";
    if !same_match {
        return current;
    }
    if current["draftStatus"] == "ready" {
        // Bans are announced once; a momentarily empty list must not erase them.
        let empty = current["draft"]["bans"]
            .as_array()
            .is_some_and(Vec::is_empty);
        if empty && kept["bans"].as_array().is_some_and(|bans| !bans.is_empty()) {
            current["draft"]["bans"] = kept["bans"].clone();
        }
        return current;
    }
    let Some(status) = current["draftStatus"]
        .as_str()
        .filter(|s| TRANSIENT.contains(s))
    else {
        return current;
    };
    let mut draft = kept.clone();
    draft["held"] = json!(status);
    draft["gameState"] = current["gameState"].clone();
    draft["observedAt"] = json!(now_ms);
    draft["hovers"] = json!([]);
    current["draft"] = draft;
    current["draftStatus"] = json!("ready");
    current
}

#[cfg(test)]
mod tests {
    use super::*;
    fn gsi() -> Value {
        json!({"mode":"player","matchId":"123","gameState":"DOTA_GAMERULES_STATE_HERO_SELECTION",
            "receivedAt":1000,"players":[{"key":"self","team":"dire"}]})
    }
    fn picks_len_limit() -> usize {
        MAX_BANS + 1
    }
    fn snapshot() -> Snapshot {
        Snapshot {
            match_id: 123,
            phase: 2,
            picks: vec![
                Pick {
                    slot: 0,
                    team: 2,
                    hero: 1,
                },
                Pick {
                    slot: 5,
                    team: 3,
                    hero: 2,
                },
            ],
            bans: vec![14],
            hovers: vec![],
            lanes: vec![],
            slots: vec![],
        }
    }
    #[test]
    fn anonymous_picks_do_not_create_profiles_and_replace_removed_picks() {
        let raw = gsi();
        let ctx = Context::fresh(&raw, 1001).unwrap();
        let out = finish_poll(raw.clone(), Some(&ctx), Ok(snapshot()), 1001);
        assert_eq!(out["players"], raw["players"]);
        assert_eq!(out["draft"]["picks"].as_array().unwrap().len(), 2);
        assert!(!out["draft"].to_string().contains("accountId"));
        assert_eq!(out["draft"]["bans"], json!([14]));
        for bans in [vec![1], vec![14, 14], vec![0], vec![7; picks_len_limit()]] {
            let bad = Snapshot { bans, ..snapshot() };
            assert!(!bad.matches(&ctx));
        }
        let empty = Snapshot {
            picks: vec![],
            ..snapshot()
        };
        let out = finish_poll(raw.clone(), Some(&ctx), Ok(empty), 1002);
        assert_eq!(out["draft"]["picks"], json!([]));
        let out = finish_poll(raw, Some(&ctx), Err("unavailable"), 1003);
        assert!(out["draft"].is_null());
    }
    #[test]
    fn serializes_intentions_separately_without_confirming_a_hover() {
        let raw = gsi();
        let ctx = Context::fresh(&raw, 1001).unwrap();
        let mut snapshot = snapshot();
        snapshot.hovers.push(Pick {
            slot: 6,
            team: 3,
            hero: 74,
        });
        snapshot.bans.push(74);
        snapshot.slots.push(Slot {
            slot: 6,
            team: 3,
            team_slot: 3,
        });
        snapshot.lanes.push(Lane {
            slot: 6,
            team: 3,
            flags: 24,
        });
        // GSI may report the own hero before the blind round reveals it: accepted
        // during hero selection, but the hover is never promoted to a pick.
        assert!(snapshot.matches(&Context {
            hero: Some(74),
            ..ctx.clone()
        }));
        assert!(snapshot.picks.iter().all(|p| p.hero != 74));
        let out = finish_poll(raw.clone(), Some(&ctx), Ok(snapshot), 1001);
        assert_eq!(out["players"], raw["players"]);
        assert_eq!(out["draft"]["picks"].as_array().unwrap().len(), 2);
        assert_eq!(
            out["draft"]["hovers"],
            json!([{"slot":6,"team":"dire","heroId":74}])
        );
        assert_eq!(
            out["draft"]["lanes"],
            json!([{"slot":6,"team":"dire","flags":24}])
        );
        assert_eq!(
            out["draft"]["slots"],
            json!([{"slot":6,"team":"dire","teamSlot":3}])
        );
        assert!(out["draft"]["bans"]
            .as_array()
            .unwrap()
            .contains(&json!(74)));
        for private in ["name", "accountId", "steamid"] {
            assert!(!out["draft"].to_string().contains(private));
        }
    }
    #[test]
    fn rejects_late_other_match_phase_team_and_stale_results() {
        let raw = gsi();
        let ctx = Context::fresh(&raw, 1001).unwrap();
        for (field, value) in [
            ("matchId", json!("124")),
            ("gameState", json!("DOTA_GAMERULES_STATE_STRATEGY_TIME")),
            ("mode", json!("spectator")),
        ] {
            let mut next = raw.clone();
            next[field] = value;
            let mut out = finish_poll(next.clone(), Some(&ctx), Ok(snapshot()), 1002);
            // The late read is never applied; within the same match it only asks to hold.
            if field == "gameState" {
                assert_eq!(out["draftStatus"], "retrying");
                out.as_object_mut().unwrap().remove("draftStatus");
            }
            assert_eq!(out, next);
        }
        assert_eq!(
            finish_poll(raw.clone(), Some(&ctx), Ok(snapshot()), 16000),
            raw
        );
        // Role-queue roles are already set while players load.
        let mut loading = raw.clone();
        loading["gameState"] = json!("DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD");
        assert_eq!(
            Context::fresh(&loading, 1001).map(|ctx| phase_number(&ctx.phase)),
            Some(Some(1))
        );
        for phase in [
            "DOTA_GAMERULES_STATE_POST_GAME",
            "DOTA_GAMERULES_STATE_INIT",
        ] {
            let mut next = raw.clone();
            next["gameState"] = json!(phase);
            assert!(Context::fresh(&next, 1001).is_none());
        }
        let mut next = raw.clone();
        next["players"][0]["team"] = json!("radiant");
        let out = finish_poll(next.clone(), Some(&ctx), Ok(snapshot()), 1002);
        assert!(out["draft"].is_null());
        assert_eq!(out["draftStatus"], "retrying");
        let mut next = raw;
        next["matchId"] = json!("0");
        assert!(Context::fresh(&next, 1001).is_none());
    }
    #[test]
    fn validates_slots_teams_heroes_and_selected_self() {
        let ctx = Context::fresh(&gsi(), 1001).unwrap();
        assert!(snapshot().matches(&ctx));
        let mut s = snapshot();
        s.picks[1].slot = 0;
        assert!(!s.matches(&ctx));
        let mut s = snapshot();
        s.picks[1].hero = 1;
        assert!(!s.matches(&ctx));
        let mut s = snapshot();
        s.picks[1].hero = 0;
        assert!(!s.matches(&ctx));
        let mut s = snapshot();
        s.picks[1].team = 1;
        assert!(!s.matches(&ctx));
        let mut s = snapshot();
        s.phase = 3;
        assert!(!s.matches(&ctx));
        let mut s = snapshot();
        s.picks = (0..6)
            .map(|slot| Pick {
                slot,
                team: 2,
                hero: slot + 1,
            })
            .collect();
        assert!(!s.matches(&ctx));
        assert!(snapshot().matches(&Context {
            hero: Some(2),
            ..ctx.clone()
        }));
        // During hero selection a locked-but-unrevealed own hero is expected.
        assert!(snapshot().matches(&Context {
            hero: Some(3),
            ..ctx.clone()
        }));
        let mut later = snapshot();
        later.phase = 3;
        assert!(!later.matches(&Context {
            hero: Some(3),
            phase: "DOTA_GAMERULES_STATE_STRATEGY_TIME".into(),
            ..ctx
        }));
    }
    #[test]
    fn carry_keeps_the_match_draft_through_transient_failures() {
        let ctx = Context::fresh(&gsi(), 1001).unwrap();
        let ready = finish_poll(gsi(), Some(&ctx), Ok(snapshot()), 1001);
        assert_eq!(ready["draftStatus"], "ready");
        // A blind round or phase switch: the confirmed draft stays, hovers go.
        for status in ["incomplete", "match-mismatch", "retrying", "unavailable"] {
            let failed = finish_poll(gsi(), Some(&ctx), Err(status), 1002);
            let out = carry(failed, &ready, 1002);
            assert_eq!(out["draftStatus"], "ready");
            assert_eq!(out["draft"]["held"], status);
            assert_eq!(out["draft"]["picks"], ready["draft"]["picks"]);
            assert_eq!(out["draft"]["bans"], ready["draft"]["bans"]);
            assert_eq!(out["draft"]["hovers"], json!([]));
            assert_eq!(out["draft"]["observedAt"], 1002);
            // Holding twice in a row keeps the same draft.
            let again = carry(
                finish_poll(gsi(), Some(&ctx), Err(status), 1003),
                &out,
                1003,
            );
            assert_eq!(again["draft"]["picks"], ready["draft"]["picks"]);
        }
        // A real failure is shown, not hidden.
        let out = carry(
            finish_poll(gsi(), Some(&ctx), Err("not-running"), 1002),
            &ready,
            1002,
        );
        assert_eq!(out["draftStatus"], "not-running");
        // Another match never inherits the draft.
        let mut other = gsi();
        other["matchId"] = json!("999");
        let out = carry(other.clone(), &ready, 1002);
        assert!(out["draft"].is_null());
        // A fresh read wins, but an empty ban list does not erase known bans.
        let mut empty = snapshot();
        empty.bans.clear();
        let out = carry(
            finish_poll(gsi(), Some(&ctx), Ok(empty), 1002),
            &ready,
            1002,
        );
        assert!(out["draft"]["held"].is_null());
        assert_eq!(out["draft"]["bans"], ready["draft"]["bans"]);
    }
    #[test]
    fn a_phase_change_during_the_read_keeps_the_draft() {
        let ctx = Context::fresh(&gsi(), 1001).unwrap();
        let ready = finish_poll(gsi(), Some(&ctx), Ok(snapshot()), 1001);
        // Observed live: Hero Selection was requested, Strategy Time arrived meanwhile.
        let mut moved = gsi();
        moved["gameState"] = json!("DOTA_GAMERULES_STATE_STRATEGY_TIME");
        let out = carry(
            finish_poll(moved.clone(), Some(&ctx), Err("match-mismatch"), 1002),
            &ready,
            1002,
        );
        assert_eq!(out["draftStatus"], "ready");
        assert_eq!(out["draft"]["held"], "retrying");
        assert_eq!(out["draft"]["picks"], ready["draft"]["picks"]);
        assert_eq!(
            out["draft"]["gameState"],
            "DOTA_GAMERULES_STATE_STRATEGY_TIME"
        );
        // Stale GSI still clears it, and another match still does not inherit it.
        let mut stale = moved.clone();
        stale["receivedAt"] = json!(0);
        let out = carry(
            finish_poll(stale, Some(&ctx), Ok(snapshot()), 20_000),
            &ready,
            20_000,
        );
        assert!(out["draft"].is_null());
        moved["matchId"] = json!("999");
        let out = carry(
            finish_poll(moved, Some(&ctx), Ok(snapshot()), 1002),
            &ready,
            1002,
        );
        assert!(out["draft"].is_null());
    }
    #[test]
    fn mismatch_names_the_failed_check_for_the_log() {
        let ctx = Context::fresh(&gsi(), 1001).unwrap();
        assert_eq!(snapshot().mismatch(&ctx), None);
        let mut s = snapshot();
        s.phase = 3;
        assert_eq!(s.mismatch(&ctx), Some("phase"));
        let mut s = snapshot();
        s.picks[1].slot = 0;
        assert_eq!(s.mismatch(&ctx), Some("pick slots unique"));
        let other = Context {
            hero: Some(3),
            phase: "DOTA_GAMERULES_STATE_STRATEGY_TIME".into(),
            ..ctx
        };
        let mut later = snapshot();
        later.phase = 3;
        assert_eq!(later.mismatch(&other), Some("own GSI hero not picked"));
        // The shared reason slot is not asserted: tests run in parallel.
        assert_eq!(incomplete("phase"), "incomplete");
        assert_eq!(tag("retrying", "unused"), "retrying");
    }
}
