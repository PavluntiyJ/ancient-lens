use crate::store::{account_id, now, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Filter {
    #[serde(default = "normal")]
    pub mode: String,
    #[serde(default)]
    pub ranked_only: bool,
}
fn normal() -> String {
    "normal".into()
}
impl Default for Filter {
    fn default() -> Self {
        Self {
            mode: normal(),
            ranked_only: false,
        }
    }
}
impl Filter {
    pub fn validate(&self) -> Result<()> {
        if ["normal", "turbo", "ability", "all"].contains(&self.mode.as_str()) {
            Ok(())
        } else {
            Err("Unknown history mode".into())
        }
    }
    pub fn includes(&self, mode: i64, lobby: i64) -> bool {
        let modes: &[i64] = match self.mode.as_str() {
            "turbo" => &[23],
            "ability" => &[18],
            "all" => &[2, 3, 22, 23],
            _ => &[2, 3, 22],
        };
        modes.contains(&mode)
            && [0, 1, 2, 7, 9].contains(&lobby)
            && !(["normal", "all"].contains(&self.mode.as_str()) && self.ranked_only && lobby == 0)
    }
    pub fn key(&self) -> String {
        format!("{}-{}", self.mode, self.ranked_only)
    }
}
pub fn days(value: u32) -> Result<u32> {
    if [7, 14, 30, 90].contains(&value) {
        Ok(value)
    } else {
        Err("Unsupported period".into())
    }
}
pub fn heroes(matches: &[Value]) -> Vec<Value> {
    let mut rows: BTreeMap<u64, (u64, u64)> = BTreeMap::new();
    for m in matches {
        if let (Some(hero), Some(won), Some(slot)) = (
            m["hero_id"].as_u64(),
            m["radiant_win"].as_bool(),
            m["player_slot"].as_u64(),
        ) {
            let row = rows.entry(hero).or_default();
            row.0 += 1;
            row.1 += ((slot < 128) == won) as u64;
        }
    }
    let mut rows: Vec<_> = rows
        .into_iter()
        .map(|(id, (games, win))| json!({"hero_id":id,"games":games,"win":win}))
        .collect();
    rows.sort_by_key(|v| std::cmp::Reverse(v["games"].as_u64().unwrap()));
    rows
}
// STRATZ enum names, independently mapped from its public schema. Numeric fixture
// values are accepted too, matching the mode/lobby values in OpenDota.
pub(crate) fn mode(v: &Value) -> i64 {
    v.as_i64()
        .unwrap_or_else(|| match v.as_str().unwrap_or("") {
            "CAPTAINS_MODE" => 2,
            "RANDOM_DRAFT" => 3,
            "SINGLE_DRAFT" => 4,
            "ALL_PICK" => 1,
            "ALL_PICK_RANKED" => 22,
            "TURBO" => 23,
            "ABILITY_DRAFT" => 18,
            _ => -1,
        })
}
pub(crate) fn lobby(v: &Value) -> i64 {
    v.as_i64()
        .unwrap_or_else(|| match v.as_str().unwrap_or("") {
            "UNRANKED" => 0,
            "PRACTICE" => 1,
            "TOURNAMENT" => 2,
            "RANKED" => 7,
            "BATTLE_CUP" => 9,
            _ => -1,
        })
}
/// The Steam profile's country (STRATZ `countryCode`) as an ISO 3166-1 alpha-2 code; the
/// field is empty when the player has not set a location.
pub(crate) fn country(v: &Value) -> Option<String> {
    v.as_str()
        .filter(|code| code.len() == 2 && code.bytes().all(|b| b.is_ascii_alphabetic()))
        .map(str::to_ascii_uppercase)
}
pub fn query(ids: &[String]) -> String {
    format!("query {{ players(steamAccountIds:[{}]) {{ steamAccountId steamAccount {{ name avatar countryCode seasonRank seasonLeaderboardRank isAnonymous }} matches(request:{{take:100,skip:0,playerList:SINGLE}}) {{ id endDateTime durationSeconds didRadiantWin gameMode lobbyType players {{ steamAccountId heroId isRadiant kills deaths assists goldPerMinute experiencePerMinute role position }} }} }} }}", ids.join(","))
}
pub fn from_stratz(
    row: &Value,
    id: &str,
    period: u32,
    filter: &Filter,
    timestamp: i64,
) -> Result<Value> {
    account_id(id)?;
    days(period)?;
    filter.validate()?;
    if row["steamAccountId"]
        .as_u64()
        .map(|n| n.to_string())
        .as_deref()
        != Some(id)
    {
        return Err("STRATZ: response belongs to a different profile".into());
    }
    let raw = row["matches"].as_array().cloned().unwrap_or_default();
    let cutoff = timestamp - period as i64 * 86400;
    let mut seen = HashSet::new();
    let mut matches = vec![];
    for m in &raw {
        let end = m["endDateTime"]
            .as_i64()
            .ok_or("STRATZ: missing match time")?;
        let duration = m["durationSeconds"]
            .as_i64()
            .ok_or("STRATZ: missing duration")?;
        let match_id = m["id"].as_u64().ok_or("STRATZ: missing match ID")?;
        if end < cutoff
            || end > timestamp
            || duration <= 0
            || !filter.includes(mode(&m["gameMode"]), lobby(&m["lobbyType"]))
            || !seen.insert(match_id)
        {
            continue;
        }
        let players: Vec<_> = m["players"]
            .as_array()
            .ok_or("STRATZ: missing players")?
            .iter()
            .filter(|p| p["steamAccountId"] == row["steamAccountId"])
            .collect();
        if players.len() != 1 {
            continue;
        }
        let p = players[0];
        let hero = p["heroId"].as_u64().ok_or("STRATZ: missing hero")?;
        let radiant = p["isRadiant"].as_bool().ok_or("STRATZ: missing team")?;
        matches.push(json!({"match_id":match_id,"hero_id":hero,"start_time":end-duration,"duration":duration,"radiant_win":m["didRadiantWin"],"player_slot":if radiant {0} else {128},"kills":p["kills"],"deaths":p["deaths"],"assists":p["assists"],"gold_per_min":p["goldPerMinute"],"xp_per_min":p["experiencePerMinute"],"role":p["role"],"position":p["position"]}));
    }
    matches.sort_by_key(|m| {
        std::cmp::Reverse((
            m["start_time"].as_i64().unwrap() + m["duration"].as_i64().unwrap(),
            m["match_id"].as_u64().unwrap(),
        ))
    });
    let limited = raw.len() >= 100
        && raw
            .iter()
            .all(|m| m["endDateTime"].as_i64().unwrap_or(0) >= cutoff);
    let mut profile = json!({"profile":{"account_id":row["steamAccountId"],"personaname":row["steamAccount"]["name"]},"rank_tier":row["steamAccount"]["seasonRank"],"leaderboard_rank":row["steamAccount"]["seasonLeaderboardRank"]});
    if let Some(avatar) = row["steamAccount"]["avatar"].as_str() {
        profile["profile"]["avatarfull"] = json!(avatar);
    }
    if let Some(country) = crate::stats::country(&row["steamAccount"]["countryCode"]) {
        profile["profile"]["loccountrycode"] = json!(country);
    }
    // The newest visible game in the selected modes, regardless of the period: tells "no games
    // in this period" from "no visible games at all" (private profile) without contradicting
    // the filtered counts (a Turbo game today is not a normal-mode game).
    let last_match_at = raw
        .iter()
        .filter(|m| filter.includes(mode(&m["gameMode"]), lobby(&m["lobbyType"])))
        .filter_map(|m| m["endDateTime"].as_i64())
        .filter(|end| *end <= timestamp)
        .max();
    let mut out = json!({"accountId":id,"days":period,"filter":filter,"source":"STRATZ","fetchedAt":now(),"profile":profile,"heroes":heroes(&matches),"matches":matches,"limited":limited,"lastMatchAt":last_match_at,"stale":false});
    if let Some(private) = row["steamAccount"]["isAnonymous"].as_bool() {
        out["isPublic"] = json!(!private);
    }
    if let (Some(games), Some(wins)) = (row["matchCount"].as_u64(), row["winCount"].as_u64()) {
        if wins <= games {
            out["total"] = json!({"games":games,"wins":wins});
        }
    }
    Ok(out)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn public_visibility_is_explicit() {
        assert!(query(&["1".into()]).contains("isAnonymous"));
        let mut row = json!({"steamAccountId":1,"matches":[]});
        let summary = |row: &Value| from_stratz(row, "1", 14, &Filter::default(), 1000000).unwrap();
        assert!(summary(&row).get("isPublic").is_none());
        row["steamAccount"] = json!({"isAnonymous":true});
        assert_eq!(summary(&row)["isPublic"], false);
        row["steamAccount"]["isAnonymous"] = json!(false);
        assert_eq!(summary(&row)["isPublic"], true);
    }
    #[test]
    fn country_is_kept_only_when_steam_has_one() {
        assert!(query(&["1".into()]).contains("countryCode"));
        let summary = |account: Value| {
            let row = json!({"steamAccountId":1,"steamAccount":account,"matches":[]});
            from_stratz(&row, "1", 14, &Filter::default(), 1000000).unwrap()["profile"]["profile"]
                ["loccountrycode"]
                .clone()
        };
        assert_eq!(summary(json!({"countryCode":"de"})), "DE");
        for missing in [
            json!({}),
            json!({"countryCode":""}),
            json!({"countryCode":"D3"}),
            json!({"countryCode":"DEU"}),
        ] {
            assert!(summary(missing).is_null());
        }
    }
    #[test]
    fn last_matching_game_ignores_the_period_but_not_the_mode_filter() {
        let m = |id: u64, end: i64| json!({"id":id,"endDateTime":end,"durationSeconds":1800,"gameMode":"ALL_PICK_RANKED","lobbyType":"RANKED","didRadiantWin":true,"players":[]});
        let summary = |matches: Vec<Value>| {
            from_stratz(
                &json!({"steamAccountId":1,"matches":matches}),
                "1",
                14,
                &Filter::default(),
                10_000_000,
            )
            .unwrap()
        };
        assert!(summary(vec![])["lastMatchAt"].is_null());
        // Older than the 14-day period, so no games in it, but the profile shows recent activity.
        let old = summary(vec![m(1, 8_000_000), m(2, 7_000_000), m(3, 20_000_000)]);
        assert_eq!(old["matches"].as_array().unwrap().len(), 0);
        assert_eq!(old["lastMatchAt"], 8_000_000);
        // A newer Turbo game outside the selected modes is not the last matching game.
        let mut turbo = m(4, 9_500_000);
        turbo["gameMode"] = json!("TURBO");
        turbo["lobbyType"] = json!("UNRANKED");
        assert_eq!(
            summary(vec![m(1, 8_000_000), turbo])["lastMatchAt"],
            8_000_000
        );
    }
    #[test]
    fn reference_filter_rules() {
        assert_eq!(mode(&json!("ALL_PICK_RANKED")), 22);
        assert_eq!(mode(&json!("ALL_PICK")), 1);
        assert_eq!(mode(&json!("SINGLE_DRAFT")), 4);
        assert_eq!(mode(&json!("UNKNOWN")), -1);
        assert_eq!(mode(&json!(4)), 4);
        let f = Filter::default();
        assert!(f.includes(22, 0));
        assert!(!f.includes(23, 7));
        assert!(!f.includes(1, 7));
        let all = Filter {
            mode: "all".into(),
            ..f.clone()
        };
        assert!(all.includes(22, 0));
        assert!(all.includes(23, 0));
        assert!(!all.includes(18, 0));
        assert!(!Filter {
            ranked_only: true,
            ..f.clone()
        }
        .includes(22, 0));
        assert!(Filter {
            ranked_only: true,
            ..f
        }
        .includes(2, 1)); // same original rule, not a guess that only lobby 7 counts
    }
    #[test]
    fn end_boundary_identity_and_dedup() {
        let timestamp = 2_000_000;
        let cutoff = timestamp - 7 * 86400;
        let m = json!({"id":15,"endDateTime":cutoff,"durationSeconds":3600,"gameMode":22,"lobbyType":7,"didRadiantWin":true,"players":[{"steamAccountId":123,"heroId":55,"isRadiant":true}]});
        let mut row = json!({"steamAccountId":123,"matchCount":20,"winCount":11,"matches":[m.clone(),m.clone()]});
        let result = from_stratz(&row, "123", 7, &Filter::default(), timestamp).unwrap();
        assert_eq!(result["heroes"][0]["games"], 1);
        assert_eq!(result["matches"][0]["start_time"], cutoff - 3600);
        row["matches"][0]["endDateTime"] = json!(cutoff - 1);
        row["matches"][1]["players"][0]["steamAccountId"] = json!(999);
        assert_eq!(
            from_stratz(&row, "123", 7, &Filter::default(), timestamp).unwrap()["matches"],
            json!([])
        );
        assert!(from_stratz(&row, "999", 7, &Filter::default(), timestamp).is_err());
    }
    #[test]
    fn unknown_outcome_not_a_loss() {
        assert!(heroes(&[json!({"hero_id":1,"player_slot":0,"radiant_win":null})]).is_empty());
    }
}
