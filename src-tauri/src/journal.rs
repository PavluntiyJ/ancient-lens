//! Local match journal: own matches recorded from GSI while the app runs, so the profile
//! keeps them even when the public match data of the account is private. A record holds
//! only what the game reported; fields GSI does not send stay absent, never zero.
use crate::store::{account_id, now, Result};
use serde_json::{json, Map, Value};

/// Statistics copied from the GSI self row into a record, as history field names.
const STATS: [(&str, &str); 11] = [
    ("kills", "kills"),
    ("deaths", "deaths"),
    ("assists", "assists"),
    ("lastHits", "last_hits"),
    ("denies", "denies"),
    ("gpm", "gold_per_min"),
    ("xpm", "xp_per_min"),
    ("netWorth", "net_worth"),
    ("heroDamage", "hero_damage"),
    ("towerDamage", "tower_damage"),
    ("heroHealing", "hero_healing"),
];
/// Team kills from the GSI map, needed for kill and death participation.
const SCORES: [(&str, &str); 2] = [
    ("radiantScore", "radiant_score"),
    ("direScore", "dire_score"),
];
/// What a match by ID adds to a record besides `STATS` (see `add_details`).
const DETAILS: [&str; 10] = [
    "imp",
    "position",
    "role",
    "lane_role",
    "game_mode",
    "lobby_type",
    "team_kills",
    "team_deaths",
    "average_rank",
    "lineup",
];
/// Records completed by an older version lack fields added since (rank, lineup); they are
/// fetched again right away, and a record is at this version once a fetch kept its players.
/// Version 2 was also given to records whose fetch failed, so they are caught up as 3.
const DETAILS_VERSION: u64 = 3;
/// Fetches beyond the schedule for such a record when one fails, ten minutes apart.
const CATCH_UP: usize = 3;
const CATCH_UP_DELAY: i64 = 600;
/// Waits before each attempt to fetch the match by ID: the first counts from the match end,
/// the others from the previous attempt. Providers index a match within minutes, STRATZ
/// computes IMP later; after the last attempt a record stays as it is.
const DETAIL_DELAYS: [i64; 5] = [120, 600, 3600, 6 * 3600, 24 * 3600];
/// A rating change read later than this after a match is not attributed to it.
const MMR_WINDOW_SECONDS: i64 = 6 * 3600;
/// Larger changes are treated as a misread rather than one match (same bound as the profile).
const MMR_MAX_DELTA: i64 = 300;
pub const LIMIT: usize = 10000;

/// Watches normalized GSI packets and yields one record when a played match ends.
#[derive(Default)]
pub struct Recorder {
    last: Option<String>,
    /// Last published draft/roster while post-game GSI still lacks a complete record.
    pending: Value,
}
impl Recorder {
    /// `roster` is the last published live state, which carries all ten players when the
    /// memory reader identified them; raw GSI in player mode knows only the own player.
    pub fn observe(&mut self, live: &Value, roster: &Value) -> Option<Value> {
        if live["mode"] != "player" || live["gameState"] != "DOTA_GAMERULES_STATE_POST_GAME" {
            return None;
        }
        let match_id = live["matchId"].as_str()?;
        if self.last.as_deref() == Some(match_id) {
            return None;
        }
        if self.pending["matchId"] != live["matchId"] {
            self.pending = Value::Null;
        }
        if roster["matchId"] == live["matchId"]
            && roster["draft"]["matchId"] == live["matchId"]
            && roster["draft"]["source"] == "native"
        {
            self.pending = roster.clone();
        }
        let mut record = record(live, &now())?;
        let roster = if self.pending.is_object() {
            &self.pending
        } else {
            roster
        };
        add_participants(&mut record, roster);
        add_queue_position(&mut record, live, roster);
        self.last = Some(match_id.into());
        self.pending = Value::Null;
        Some(record)
    }
}

fn add_queue_position(row: &mut Value, live: &Value, roster: &Value) {
    let draft = &roster["draft"];
    if roster["matchId"] != live["matchId"]
        || draft["matchId"] != live["matchId"]
        || draft["source"] != "native"
    {
        return;
    }
    let Some(own) = live["players"]
        .as_array()
        .and_then(|players| players.iter().find(|p| p["key"] == "self"))
    else {
        return;
    };
    // record() uses slot zero when GSI omits it; that is not evidence of a queued role.
    let Some(team_slot) = own["teamSlot"].as_u64().filter(|slot| *slot < 5) else {
        return;
    };
    let Some(slot) = draft["slots"].as_array().and_then(|slots| {
        slots
            .iter()
            .find(|slot| slot["team"] == own["team"] && slot["teamSlot"] == team_slot)
    }) else {
        return;
    };
    let flags = draft["lanes"]
        .as_array()
        .and_then(|lanes| {
            lanes
                .iter()
                .find(|lane| lane["slot"] == slot["slot"] && lane["team"] == own["team"])
        })
        .and_then(|lane| lane["flags"].as_u64());
    // ELaneSelectionFlags: Safe, Mid, Off, Support, HardSupport. Multiple bits stay unknown.
    let position = match flags {
        Some(1) => 1,
        Some(4) => 2,
        Some(2) => 3,
        Some(8) => 4,
        Some(16) => 5,
        _ => return,
    };
    row["queue_position"] = json!(position);
}

/// Other players with a public account from a roster of the same match, by own team.
pub fn add_participants(row: &mut Value, roster: &Value) {
    let same = roster["matchId"]
        .as_str()
        .and_then(|id| id.parse::<u64>().ok())
        .is_some_and(|id| row["match_id"] == id);
    let own = row["accountId"].as_str().unwrap_or("").to_owned();
    let own_radiant = row["player_slot"].as_u64().is_some_and(|s| s < 128);
    let (mut allies, mut enemies) = (vec![], vec![]);
    for p in roster["players"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|_| same)
    {
        let Some(id) = p["accountId"]
            .as_str()
            .and_then(|id| account_id(id).ok())
            .filter(|id| *id != own && id != "4294967295")
            .and_then(|id| id.parse::<u32>().ok())
        else {
            continue;
        };
        // The memory reader knows the heroes of others but not their K/D/A.
        let mut entry = json!({"id": id});
        if let Some(hero) = p["heroId"].as_u64().filter(|hero| *hero > 0) {
            entry["hero"] = json!(hero);
        }
        match p["team"].as_str() {
            Some("radiant") if own_radiant => allies.push(entry),
            Some("dire") if !own_radiant => allies.push(entry),
            Some("radiant" | "dire") => enemies.push(entry),
            _ => {}
        }
    }
    if !allies.is_empty() || !enemies.is_empty() {
        row["allies"] = json!(allies);
        row["enemies"] = json!(enemies);
    }
}

/// The record of a finished match from its first post-game packet; `None` when the packet
/// lacks the match, the player, the hero, the winner or a positive duration.
pub fn record(live: &Value, recorded_at: &str) -> Option<Value> {
    let match_id = live["matchId"]
        .as_str()?
        .parse::<u64>()
        .ok()
        .filter(|id| *id > 0)?;
    let player = live["players"]
        .as_array()?
        .iter()
        .find(|p| p["key"] == "self")?;
    let account = account_id(player["accountId"].as_str()?).ok()?;
    let radiant = match player["team"].as_str()? {
        "radiant" => true,
        "dire" => false,
        _ => return None,
    };
    let radiant_win = match live["winTeam"].as_str()? {
        "radiant" => true,
        "dire" => false,
        _ => return None,
    };
    let hero = player["heroId"].as_u64().filter(|id| *id > 0)?;
    // The game clock stops when the Ancient falls, so it is the match duration.
    let duration = live["clock"].as_i64().filter(|d| *d > 0 && *d <= 86400)?;
    let end = chrono::DateTime::parse_from_rfc3339(recorded_at)
        .ok()?
        .timestamp();
    let slot = player["teamSlot"].as_u64().unwrap_or(0);
    let mut row = json!({
        "accountId": account,
        "match_id": match_id,
        "hero_id": hero,
        "start_time": end - duration,
        "duration": duration,
        "radiant_win": radiant_win,
        "player_slot": if radiant { slot } else { 128 + slot },
        "source": "game",
        "recordedAt": recorded_at,
    });
    for (from, to) in STATS {
        if let Some(value) = player[from].as_i64().filter(|v| *v >= 0) {
            row[to] = json!(value);
        }
    }
    for (from, to) in SCORES {
        if let Some(value) = live[from].as_i64().filter(|v| *v >= 0) {
            row[to] = json!(value);
        }
    }
    Some(row)
}

pub fn validate(row: &Value) -> Result<()> {
    let invalid = "Invalid match record";
    account_id(row["accountId"].as_str().ok_or(invalid)?)?;
    let positive = |key: &str| row[key].as_u64().is_some_and(|v| v > 0);
    if !positive("match_id")
        || !positive("hero_id")
        || !row["duration"]
            .as_i64()
            .is_some_and(|d| (1..=86400).contains(&d))
        || !row["start_time"].is_i64()
        || !row["radiant_win"].is_boolean()
        || !row["player_slot"]
            .as_u64()
            .is_some_and(|s| s < 5 || (128..133).contains(&s))
        || row["source"] != "game"
        || !row["recordedAt"].is_string()
        || STATS
            .iter()
            .chain(&SCORES)
            .any(|(_, key)| !(row[key].is_null() || row[key].is_u64()))
        || ["mmr_before", "mmr_after"].iter().any(|key| {
            !(row[*key].is_null() || row[*key].as_u64().is_some_and(|m| (1..=20000).contains(&m)))
        })
        || !(row["mmr_delta"].is_null() || row["mmr_delta"].is_i64())
        || !(row["queue_position"].is_null()
            || row["queue_position"]
                .as_u64()
                .is_some_and(|p| (1..=5).contains(&p)))
        || [
            "lane_role",
            "game_mode",
            "lobby_type",
            "team_kills",
            "team_deaths",
            "average_rank",
            "medal_rank",
            "detailsAttempts",
            "detailsVersion",
        ]
        .iter()
        .any(|key| !(row[*key].is_null() || row[*key].is_u64()))
        || !(row["imp"].is_null() || row["imp"].is_i64())
        || ["position", "role", "detailsAt"]
            .iter()
            .any(|key| !(row[*key].is_null() || row[*key].as_str().is_some_and(|v| v.len() <= 40)))
        || !(row["details"].is_null()
            || row["details"].as_array().is_some_and(|sources| {
                sources.len() <= 2 && sources.iter().all(|s| s == "STRATZ" || s == "OpenDota")
            }))
        || !(row["lineup"].is_null()
            || row["lineup"].as_array().is_some_and(|players| {
                players.len() <= 10 && players.iter().all(|p| p["radiant"].is_boolean())
            }))
        || ["allies", "enemies"].iter().any(|key| {
            !(row[*key].is_null()
                || row[*key].as_array().is_some_and(|ids| {
                    ids.len() <= 9
                        && ids.iter().all(|p| {
                            p["id"]
                                .as_u64()
                                .is_some_and(|id| id > 0 && id <= u32::MAX as u64)
                                && ["hero", "kills", "deaths", "assists"]
                                    .iter()
                                    .all(|key| p[*key].is_null() || p[*key].is_u64())
                        })
                }))
        })
    {
        return Err(invalid.into());
    }
    Ok(())
}

/// Whether a record still lacks what a match by ID provides: any provider data at all, or,
/// while a STRATZ service is configured, IMP or the rank of a ranked match.
pub fn details_missing(row: &Value, stratz: bool) -> bool {
    row["details"].as_array().is_none_or(Vec::is_empty)
        || (stratz
            && (!row["imp"].is_i64() || (row["lobby_type"] == 7 && !row["average_rank"].is_u64())))
}
/// Whether to fetch the match of a record now (`now` in Unix seconds).
pub fn details_due(row: &Value, now: i64, stratz: bool) -> bool {
    let attempts = row["detailsAttempts"].as_u64().unwrap_or(0) as usize;
    if !details_missing(row, false) && row["detailsVersion"].as_u64() != Some(DETAILS_VERSION) {
        return attempts < DETAIL_DELAYS.len() + CATCH_UP
            && now >= seconds(&row["detailsAt"]).unwrap_or(0) + CATCH_UP_DELAY;
    }
    let Some(delay) = DETAIL_DELAYS.get(attempts) else {
        return false;
    };
    let since = if attempts == 0 {
        end(row)
    } else {
        seconds(&row["detailsAt"]).unwrap_or(0)
    };
    details_missing(row, stratz) && now >= since + delay
}
pub fn details_attempted(row: &mut Value, at: &str) {
    row["detailsAttempts"] = json!(row["detailsAttempts"].as_u64().unwrap_or(0) + 1);
    row["detailsAt"] = json!(at);
}
fn fill(row: &mut Value, key: &str, value: &Value) {
    if row[key].is_null() && !value.is_null() {
        row[key] = value.clone();
    }
}
/// All ten players of a match by ID in the history `lineup` shape, so the profile ranks a
/// recorded match like a STRATZ one: the own slot marked, other public accounts by ID.
fn lineup(players: &[Value], own: &Value) -> Vec<Value> {
    players
        .iter()
        .map(|p| {
            let mut entry = json!({"radiant": p["radiant"]});
            if p["radiant"] == own["radiant"] && p["hero_id"] == own["hero_id"] {
                entry["own"] = json!(true);
            } else if let Some(id) = p["account"].as_u64().filter(|id| *id <= u32::MAX as u64) {
                entry["id"] = json!(id);
            }
            for key in STATS
                .iter()
                .map(|(_, key)| *key)
                .chain(["hero_id", "imp", "position"])
            {
                if !p[key].is_null() {
                    entry[key] = p[key].clone();
                }
            }
            entry
        })
        .collect()
}
/// Adds what a match by ID (`match_details` shape) knows to a record without replacing what
/// the game reported: missing statistics, mode, team totals, IMP and position, and K/D/A of
/// the other players. Returns false when the recorded player is not in that match.
pub fn add_details(row: &mut Value, details: &Value) -> bool {
    let Some(own) = crate::match_details::own(row, details).cloned() else {
        return false;
    };
    for (_, key) in STATS {
        fill(row, key, &own[key]);
    }
    for key in ["imp", "position", "role", "lane_role"] {
        fill(row, key, &own[key]);
    }
    for key in ["game_mode", "lobby_type", "average_rank"] {
        fill(row, key, &details[key]);
    }
    let radiant = own["radiant"] == true;
    if let Some((kills, deaths)) =
        crate::history::team_totals(&details["players"], "radiant", radiant)
    {
        fill(row, "team_kills", &json!(kills));
        fill(row, "team_deaths", &json!(deaths));
    }
    let others: Vec<&Value> = details["players"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|p| p["hero_id"] != own["hero_id"])
        .collect();
    for (key, ally) in [("allies", true), ("enemies", false)] {
        let team: Vec<&Value> = others
            .iter()
            .copied()
            .filter(|p| (p["radiant"] == radiant) == ally)
            .collect();
        if let Some(entries) = row[key].as_array_mut() {
            // A roster from the game has accounts and heroes; the match adds their K/D/A.
            for entry in entries.iter_mut() {
                let found = team.iter().find(|p| {
                    (!p["account"].is_null() && p["account"] == entry["id"])
                        || (!entry["hero"].is_null() && p["hero_id"] == entry["hero"])
                });
                if let Some(p) = found {
                    fill(entry, "hero", &p["hero_id"]);
                    for stat in ["kills", "deaths", "assists"] {
                        fill(entry, stat, &p[stat]);
                    }
                }
            }
        } else {
            let entries: Vec<Value> = team
                .iter()
                .filter(|p| p["account"].is_u64())
                .map(|p| {
                    let mut entry = json!({"id":p["account"],"hero":p["hero_id"]});
                    for stat in ["kills", "deaths", "assists"] {
                        fill(&mut entry, stat, &p[stat]);
                    }
                    entry
                })
                .collect();
            if !entries.is_empty() {
                row[key] = json!(entries);
            }
        }
    }
    if let Some(players) = details["players"].as_array().filter(|p| p.len() == 10) {
        fill(row, "lineup", &json!(lineup(players, &own)));
    }
    if !row["lineup"].is_null() {
        row["detailsVersion"] = json!(DETAILS_VERSION);
    }
    let mut sources: Vec<Value> = row["details"].as_array().cloned().unwrap_or_default();
    if !sources.contains(&details["source"]) {
        sources.push(details["source"].clone());
    }
    row["details"] = json!(sources);
    true
}

fn end(row: &Value) -> i64 {
    row["start_time"].as_i64().unwrap_or(0) + row["duration"].as_i64().unwrap_or(0)
}
fn seconds(at: &Value) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(at.as_str()?)
        .ok()
        .map(|t| t.timestamp())
}
/// Rating measurements read from the game for one account, oldest first.
fn measurements<'a>(entries: &'a [Value], account: &'a str) -> Vec<(i64, i64)> {
    let mut list: Vec<_> = entries
        .iter()
        .filter(|e| e["accountId"] == account && e["source"] == "dota-memory")
        .filter_map(|e| Some((seconds(&e["createdAt"])?, e["value"].as_i64()?)))
        .collect();
    list.sort();
    list
}
/// The rating at the start of a new record: the last measurement before the match began.
pub fn baseline(row: &mut Value, entries: &[Value]) {
    let account = row["accountId"].as_str().unwrap_or("").to_owned();
    let start = row["start_time"].as_i64().unwrap_or(0);
    if let Some((_, value)) = measurements(entries, &account)
        .into_iter()
        .rev()
        .find(|(at, _)| *at <= start)
    {
        row["mmr_before"] = json!(value);
    }
}
/// Attributes a rating change to the account's latest recorded match when it still waits
/// for one: the first measurement after the match began that differs from its baseline,
/// read within six hours of its end. Returns whether a record changed. An unchanged rating
/// stays unresolved (it is not proof of a zero change), and so does an implausible jump.
pub fn attribute(rows: &mut [Value], entries: &[Value], account: &str) -> bool {
    let Some(row) = rows
        .iter_mut()
        .filter(|r| r["accountId"] == account)
        .max_by_key(|r| end(r))
    else {
        return false;
    };
    let Some(before) = row["mmr_before"].as_i64() else {
        return false;
    };
    if !row["mmr_after"].is_null() {
        return false;
    }
    let (start, finish) = (row["start_time"].as_i64().unwrap_or(0), end(row));
    let Some((_, after)) = measurements(entries, account)
        .into_iter()
        .find(|(at, value)| *at > start && *at <= finish + MMR_WINDOW_SECONDS && *value != before)
    else {
        return false;
    };
    if (after - before).abs() > MMR_MAX_DELTA {
        return false;
    }
    row["mmr_after"] = json!(after);
    row["mmr_delta"] = json!(after - before);
    true
}

/// Adds the account's recorded matches to a provider history page. A match the provider
/// also has keeps the provider row and gains only the fields the provider left empty; a
/// match it lacks (private data, or not yet indexed) is added from the record.
pub fn merge(mut history: Value, records: &[Value]) -> Value {
    let account = history["accountId"].as_str().unwrap_or("").to_owned();
    let records: Vec<_> = records
        .iter()
        .filter(|r| r["accountId"] == account.as_str())
        .collect();
    history["recordedCount"] = json!(records.len());
    if records.is_empty() {
        return history;
    }
    let mut matches: Vec<Value> = history["matches"].as_array().cloned().unwrap_or_default();
    for record in records {
        let found = matches
            .iter_mut()
            .find(|m| m["match_id"].as_u64().is_some() && m["match_id"] == record["match_id"]);
        match found {
            Some(row) => {
                for key in STATS
                    .iter()
                    .chain(&SCORES)
                    .map(|(_, key)| key)
                    .chain(&DETAILS)
                    .chain(&["medal_rank", "queue_position"])
                {
                    fill(row, key, &record[*key]);
                }
                for key in ["allies", "enemies"] {
                    if row[key].is_null() && !record[key].is_null() {
                        row[key] = record[key].clone();
                    }
                }
                row["recorded"] = json!(true);
                copy_rating(row, record);
            }
            None => {
                let mut row: Map<String, Value> = record.as_object().cloned().unwrap_or_default();
                for key in [
                    "accountId",
                    "source",
                    "recordedAt",
                    "mmr_before",
                    "detailsAttempts",
                    "detailsAt",
                    "detailsVersion",
                ] {
                    row.remove(key);
                }
                let mut row = Value::Object(row);
                row["recorded"] = json!(true);
                row["local_only"] = json!(true);
                // A rating only changes after ranked matchmaking; GSI reports no mode.
                if !record["mmr_delta"].is_null() && row["lobby_type"].is_null() {
                    row["lobby_type"] = json!(7);
                }
                matches.push(row);
            }
        }
    }
    matches.sort_by_key(|m| {
        std::cmp::Reverse((
            m["start_time"].as_i64().unwrap_or(0),
            m["match_id"].as_u64().unwrap_or(0),
        ))
    });
    history["matches"] = json!(matches);
    history
}
fn copy_rating(row: &mut Value, record: &Value) {
    for key in ["mmr_after", "mmr_delta"] {
        if !record[key].is_null() {
            row[key] = record[key].clone();
        }
    }
}
/// History made only of recorded matches, for when the provider has nothing to show.
pub fn local_history(account: &str, source: &Value, warning: Option<String>) -> Value {
    json!({"accountId":account,"source":source,"fetchedAt":now(),"profile":{"profile":{}},"matches":[],"hasMore":false,"nextOffset":0,"historyUnavailable":true,"stale":true,"warning":warning})
}

#[cfg(test)]
mod tests {
    use super::*;
    const AT: &str = "2026-10-23T20:00:00.000Z";
    fn post_game() -> Value {
        json!({"mode":"player","status":"connected","matchId":"8012345678","gameState":"DOTA_GAMERULES_STATE_POST_GAME",
            "clock":2400,"winTeam":"dire","players":[{"key":"self","team":"dire","teamSlot":2,"accountId":"123",
            "heroId":74,"kills":9,"deaths":3,"assists":14,"lastHits":310,"denies":12,"gpm":655,"xpm":702}]})
    }
    #[test]
    fn a_finished_match_is_recorded_once_without_inventing_missing_fields() {
        let row = record(&post_game(), AT).unwrap();
        validate(&row).unwrap();
        assert_eq!(row["match_id"], 8012345678u64);
        assert_eq!(row["player_slot"], 130);
        assert_eq!(row["radiant_win"], false);
        assert_eq!(row["duration"], 2400);
        assert_eq!(row["start_time"], 1792785600 - 2400);
        assert_eq!(
            (&row["gold_per_min"], &row["last_hits"]),
            (&json!(655), &json!(310))
        );
        // Player-mode GSI sends no damage or net worth: absent, not zero.
        assert!(row.get("hero_damage").is_none() && row.get("net_worth").is_none());
        let mut recorder = Recorder::default();
        assert!(recorder.observe(&post_game(), &Value::Null).is_some());
        assert!(recorder.observe(&post_game(), &Value::Null).is_none());
    }
    #[test]
    fn spectated_unfinished_or_incomplete_matches_are_not_recorded() {
        let mut recorder = Recorder::default();
        for change in [
            json!({"mode":"spectator"}),
            json!({"gameState":"DOTA_GAMERULES_STATE_GAME_IN_PROGRESS"}),
            json!({"winTeam":"none"}),
            json!({"clock":-30}),
            json!({"matchId":"0"}),
        ] {
            let mut live = post_game();
            for (key, value) in change.as_object().unwrap() {
                live[key] = value.clone();
            }
            assert!(recorder.observe(&live, &Value::Null).is_none(), "{change}");
        }
        let mut live = post_game();
        live["players"][0]["heroId"] = json!(0);
        assert!(record(&live, AT).is_none());
        live = post_game();
        live["players"][0]
            .as_object_mut()
            .unwrap()
            .remove("accountId");
        assert!(record(&live, AT).is_none());
    }
    #[test]
    fn participants_come_only_from_a_roster_of_the_same_match() {
        let mut roster = post_game();
        roster["players"] = json!([{"key":"self","team":"dire","accountId":"123"},
            {"key":"native.1","team":"dire","accountId":"55","heroId":14},{"key":"native.2","team":"radiant","accountId":"66"},
            {"key":"native.3","team":"radiant","accountId":"4294967295"},{"key":"native.4","team":"radiant"}]);
        let row = Recorder::default().observe(&post_game(), &roster).unwrap();
        assert_eq!(
            (&row["allies"], &row["enemies"]),
            (&json!([{"id":55,"hero":14}]), &json!([{"id":66}]))
        );
        validate(&row).unwrap();
        roster["matchId"] = json!("1");
        let row = Recorder::default().observe(&post_game(), &roster).unwrap();
        assert!(row.get("allies").is_none());
    }
    #[test]
    fn queue_position_uses_only_the_own_slot_and_one_lane_bit() {
        for (team, radiant) in [("dire", false), ("radiant", true)] {
            let mut live = post_game();
            live["players"][0]["team"] = json!(team);
            let mut roster = live.clone();
            roster["draft"] = json!({"source":"native","matchId":"8012345678",
                "slots":[{"slot":9,"team":team,"teamSlot":2},
                    {"slot":4,"team":if radiant {"dire"} else {"radiant"},"teamSlot":2}],
                "lanes":[{"slot":4,"team":if radiant {"dire"} else {"radiant"},"flags":16},
                    {"slot":9,"team":team,"flags":1}]});
            for (flags, expected) in [(1, 1), (4, 2), (2, 3), (8, 4), (16, 5)] {
                roster["draft"]["lanes"][1]["flags"] = json!(flags);
                let row = Recorder::default().observe(&live, &roster).unwrap();
                assert_eq!(row["queue_position"], expected, "{team} flags={flags}");
                validate(&row).unwrap();
            }
            for flags in [
                json!(0),
                json!(24),
                json!(31),
                json!(32),
                json!(-1),
                json!(1.5),
                Value::Null,
            ] {
                roster["draft"]["lanes"][1]["flags"] = flags;
                let row = Recorder::default().observe(&live, &roster).unwrap();
                assert!(row.get("queue_position").is_none());
            }
            roster["draft"]["lanes"][1]["flags"] = json!(4);
            for change in [
                json!({"matchId":"1"}),
                json!({"draft":{"matchId":"1"}}),
                json!({"draft":{"source":"other"}}),
                json!({"draft":{"slots":[]}}),
                json!({"draft":{"lanes":[]}}),
            ] {
                let mut wrong = roster.clone();
                for (key, value) in change.as_object().unwrap() {
                    if key == "draft" {
                        for (key, value) in value.as_object().unwrap() {
                            wrong["draft"][key] = value.clone();
                        }
                    } else {
                        wrong[key] = value.clone();
                    }
                }
                let row = Recorder::default().observe(&live, &wrong).unwrap();
                assert!(row.get("queue_position").is_none(), "{change}");
            }
            for slot in [Value::Null, json!(-1), json!(5)] {
                live["players"][0]["teamSlot"] = slot;
                let row = Recorder::default().observe(&live, &roster).unwrap();
                assert!(row.get("queue_position").is_none());
            }
            live["players"][0]["teamSlot"] = json!(2);
            let mut incomplete = live.clone();
            incomplete["winTeam"] = Value::Null;
            let mut recorder = Recorder::default();
            assert!(recorder.observe(&incomplete, &roster).is_none());
            live["matchId"] = json!("8012345679");
            let row = recorder.observe(&live, &Value::Null).unwrap();
            assert!(
                row.get("queue_position").is_none(),
                "Pending lanes cannot follow another match"
            );
        }
    }
    #[test]
    fn queue_position_is_validated_and_fills_provider_gaps() {
        let mut row = record(&post_game(), AT).unwrap();
        for value in [json!(0), json!(6), json!(-1), json!(1.5), json!("2")] {
            row["queue_position"] = value;
            assert!(validate(&row).is_err());
        }
        for value in [Value::Null, json!(1), json!(5)] {
            row["queue_position"] = value;
            validate(&row).unwrap();
        }
        row["queue_position"] = json!(2);
        for value in [Value::Null, json!(4)] {
            let history = json!({"accountId":"123","matches":[{
                "match_id":8012345678u64,"position":"POSITION_3","queue_position":value}]});
            let out = merge(history, &[row.clone()]);
            assert_eq!(
                out["matches"][0]["queue_position"],
                if value.is_null() { json!(2) } else { value }
            );
            assert_eq!(out["matches"][0]["position"], "POSITION_3");
        }
        let out = merge(json!({"accountId":"123","matches":[]}), &[row]);
        assert_eq!(out["matches"][0]["queue_position"], 2);
    }
    fn entry(value: u32, at: &str) -> Value {
        json!({"accountId":"123","source":"dota-memory","value":value,"createdAt":at})
    }
    #[test]
    fn a_rating_change_after_the_match_belongs_to_it() {
        let mut rows = vec![record(&post_game(), AT).unwrap()];
        let mut entries = vec![entry(4000, "2026-10-22T10:00:00Z")];
        baseline(&mut rows[0], &entries);
        assert_eq!(rows[0]["mmr_before"], 4000);
        assert!(!attribute(&mut rows, &entries, "123"));
        entries.push(entry(4027, "2026-10-23T20:01:30Z"));
        assert!(attribute(&mut rows, &entries, "123"));
        assert_eq!(
            (&rows[0]["mmr_after"], &rows[0]["mmr_delta"]),
            (&json!(4027), &json!(27))
        );
        validate(&rows[0]).unwrap();
        // Already resolved: a later reading belongs to the next match, not this one.
        entries.push(entry(4001, "2026-10-23T21:01:30Z"));
        assert!(!attribute(&mut rows, &entries, "123"));
    }
    #[test]
    fn late_implausible_or_foreign_changes_stay_unattributed() {
        let base = vec![entry(4000, "2026-10-22T10:00:00Z")];
        for later in [
            entry(4027, "2026-10-24T03:00:00Z"),
            entry(4900, "2026-10-23T20:01:00Z"),
            json!({"accountId":"456","source":"dota-memory","value":4027,"createdAt":"2026-10-23T20:01:00Z"}),
            json!({"accountId":"123","source":"manual","value":4027,"createdAt":"2026-10-23T20:01:00Z"}),
        ] {
            let mut rows = vec![record(&post_game(), AT).unwrap()];
            baseline(&mut rows[0], &base);
            let entries = [base.clone(), vec![later.clone()]].concat();
            assert!(!attribute(&mut rows, &entries, "123"), "{later}");
        }
        // Without a baseline there is nothing to subtract from.
        let mut rows = vec![record(&post_game(), AT).unwrap()];
        assert!(!attribute(
            &mut rows,
            &[entry(4027, "2026-10-23T20:01:00Z")],
            "123"
        ));
    }
    #[test]
    fn merging_fills_gaps_and_adds_matches_the_provider_lacks() {
        let mut ranked = record(&post_game(), AT).unwrap();
        ranked["mmr_before"] = json!(4000);
        ranked["mmr_after"] = json!(4027);
        ranked["mmr_delta"] = json!(27);
        let mut known = ranked.clone();
        known["match_id"] = json!(7);
        known["start_time"] = json!(100);
        let other = json!({"accountId":"456","match_id":9,"start_time":1});
        let history = json!({"accountId":"123","matches":[{"match_id":7,"start_time":100,"kills":2,"last_hits":null,"game_mode":22,"lobby_type":0}]});
        let out = merge(history, &[known, ranked, other]);
        let matches = out["matches"].as_array().unwrap();
        assert_eq!(out["recordedCount"], 2);
        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0]["match_id"], 8012345678u64);
        assert_eq!(matches[0]["local_only"], true);
        assert_eq!(matches[0]["lobby_type"], 7);
        assert!(matches[0].get("accountId").is_none() && matches[0].get("mmr_before").is_none());
        // The provider row wins; only its empty fields come from the record.
        assert_eq!(
            (&matches[1]["kills"], &matches[1]["last_hits"]),
            (&json!(2), &json!(310))
        );
        assert_eq!(
            (&matches[1]["lobby_type"], &matches[1]["recorded"]),
            (&json!(0), &json!(true))
        );
        assert!(matches[1].get("local_only").is_none());
        assert_eq!(matches[1]["mmr_delta"], 27);
    }
    #[test]
    fn a_match_by_id_fills_only_what_the_game_did_not_report() {
        use crate::match_details::{from_opendota, tests as fixture};
        let mut row = fixture::record();
        row["allies"] = json!([{"id":106,"hero":7},{"id":555,"hero":8},{"id":556}]);
        let mut details = from_opendota(42, &fixture::opendota()).unwrap();
        details["average_rank"] = json!(72);
        assert!(add_details(&mut row, &details));
        assert_eq!(row["average_rank"], 72);
        // The game's own K/D/A stays; damage, net worth and mode come from the match.
        assert_eq!(
            (&row["kills"], &row["hero_damage"]),
            (&json!(8), &json!(12000))
        );
        assert_eq!(
            (&row["game_mode"], &row["lobby_type"]),
            (&json!(22), &json!(7))
        );
        // Dire players 5–9: kills 5+6+7+8+9, two deaths each.
        assert_eq!(
            (&row["team_kills"], &row["team_deaths"]),
            (&json!(35), &json!(10))
        );
        // Roster entries gain K/D/A by account or hero; one the match cannot place stays.
        assert_eq!(
            row["allies"],
            json!([{"id":106,"hero":7,"kills":6,"deaths":2,"assists":3},
                {"id":555,"hero":8,"kills":7,"deaths":2,"assists":3},{"id":556}])
        );
        // Without a roster, only public accounts of the match are kept.
        assert_eq!(
            row["enemies"],
            json!([{"id":100,"hero":1,"kills":0,"deaths":2,"assists":3},
                {"id":102,"hero":3,"kills":2,"deaths":2,"assists":3},
                {"id":104,"hero":5,"kills":4,"deaths":2,"assists":3}])
        );
        assert_eq!(row["details"], json!(["OpenDota"]));
        assert_eq!(
            row["detailsVersion"], DETAILS_VERSION,
            "up to date once the players are kept"
        );
        // All ten players, as in a STRATZ history page: own slot marked, public accounts kept.
        let lineup = row["lineup"].as_array().unwrap();
        assert_eq!(lineup.len(), 10);
        let own = lineup.iter().find(|p| p["own"] == true).unwrap();
        assert_eq!(
            (&own["hero_id"], &own["radiant"]),
            (&json!(75), &json!(false))
        );
        assert!(own.get("id").is_none());
        assert_eq!(lineup[0]["id"], 100);
        assert!(lineup[1].get("id").is_none(), "anonymous");
        assert_eq!(
            (&lineup[3]["gold_per_min"], &lineup[3]["hero_damage"]),
            (&json!(400), &json!(12000))
        );
        assert!(add_details(&mut row, &details));
        assert_eq!(
            row["details"],
            json!(["OpenDota"]),
            "a source is listed once"
        );
        let mut other = fixture::record();
        other["hero_id"] = json!(9);
        assert!(!add_details(&mut other, &details));
        assert!(other.get("details").is_none());
    }
    #[test]
    fn matches_are_fetched_on_a_backoff_until_complete() {
        let mut row = record(&post_game(), AT).unwrap();
        let end = 1792785600;
        assert!(
            !details_due(&row, end + 60, false),
            "providers need a moment"
        );
        assert!(details_due(&row, end + 120, false));
        details_attempted(&mut row, AT);
        validate(&row).unwrap();
        assert!(!details_due(&row, end + 599, false));
        assert!(details_due(&row, end + 600, false));
        // An attempt alone does not bring a record up to date; fetched data does.
        assert!(row["detailsVersion"].is_null());
        row["details"] = json!(["OpenDota"]);
        row["detailsVersion"] = json!(DETAILS_VERSION);
        assert!(!details_due(&row, end + 600, false));
        // With a STRATZ service, a missing IMP keeps the record pending.
        assert!(details_due(&row, end + 600, true));
        row["imp"] = json!(-4);
        validate(&row).unwrap();
        assert!(!details_due(&row, end + 600, true));
        // A record completed before ranks and lineups were kept is fetched again right away,
        // even with its attempts used up; a failed fetch is retried after 10 minutes, at most
        // three times beyond the schedule.
        let mut old = row.clone();
        old["average_rank"] = Value::Null;
        old["detailsAttempts"] = json!(DETAIL_DELAYS.len());
        old.as_object_mut().unwrap().remove("detailsVersion");
        assert!(details_due(&old, end + 600, true));
        assert!(
            details_due(&old, end + 600, false),
            "the lineup comes from either provider"
        );
        let later = "2026-10-23T21:00:00.000Z";
        for _ in 0..3 {
            details_attempted(&mut old, later);
            assert!(!details_due(&old, end + 3600 + 599, true));
        }
        assert!(
            !details_due(&old, end + 30 * 86400, true),
            "catch-up attempts are bounded"
        );
        let mut retry = old.clone();
        retry["detailsAttempts"] = json!(DETAIL_DELAYS.len() + 1);
        assert!(details_due(&retry, end + 3600 + 600, true));
        // A ranked match also waits for its rank, which older records lack.
        row["lobby_type"] = json!(7);
        assert!(details_due(&row, end + 600, true));
        assert!(!details_due(&row, end + 600, false));
        row["average_rank"] = json!(72);
        row["lineup"] = json!([{"radiant":true,"own":true,"hero_id":1,"kills":3}]);
        validate(&row).unwrap();
        row["lineup"] = json!([{"hero_id":1}]);
        assert!(validate(&row).is_err(), "a lineup entry needs its side");
        row["lineup"] = json!([{"radiant":true,"own":true,"hero_id":1,"kills":3}]);
        assert!(!details_due(&row, end + 600, true));
        row["imp"] = Value::Null;
        for _ in 1..DETAIL_DELAYS.len() {
            details_attempted(&mut row, AT);
        }
        assert!(
            !details_due(&row, end + 30 * 86400, true),
            "attempts are bounded"
        );
    }
    #[test]
    fn merged_records_carry_details_but_not_their_schedule() {
        let mut row = record(&post_game(), AT).unwrap();
        row["mmr_delta"] = json!(-25);
        row["mmr_after"] = json!(3975);
        row["lobby_type"] = json!(0);
        row["imp"] = json!(7);
        row["average_rank"] = json!(72);
        row["lineup"] = json!([{"radiant":true,"own":true,"hero_id":1}]);
        row["details"] = json!(["STRATZ"]);
        details_attempted(&mut row, AT);
        let out = merge(json!({"accountId":"123","matches":[]}), &[row.clone()]);
        let m = &out["matches"][0];
        assert_eq!((&m["imp"], &m["details"]), (&json!(7), &json!(["STRATZ"])));
        assert_eq!(m["average_rank"], 72);
        assert_eq!(m["lineup"][0]["own"], true);
        assert!(m.get("detailsVersion").is_none());
        assert_eq!(
            m["lobby_type"], 0,
            "a known lobby is not replaced by the ranked guess"
        );
        assert!(m.get("detailsAttempts").is_none() && m.get("detailsAt").is_none());
        row["medal_rank"] = json!(54);
        let history = json!({"accountId":"123","matches":[{"match_id":8012345678u64,"start_time":1,"imp":null}]});
        let provider = &merge(history, &[row])["matches"][0];
        assert_eq!(
            (&provider["imp"], &provider["medal_rank"]),
            (&json!(7), &json!(54))
        );
    }
}
