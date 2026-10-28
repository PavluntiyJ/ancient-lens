//! Paginated personal history. No inferred MMR is stored in API match records.
use crate::store::{account_id, now, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub id: String,
    #[serde(default)]
    pub offset: u32,
}
impl Request {
    pub fn validate(&mut self) -> Result<()> {
        self.id = account_id(&self.id)?;
        if self.offset > 5000 {
            return Err("History offset exceeds limit".into());
        }
        Ok(())
    }
}
pub fn query(request: &Request) -> String {
    format!("{{ player(steamAccountId:{}) {{ steamAccountId steamAccount {{ name avatar countryCode seasonRank seasonLeaderboardRank isAnonymous }} matches(request:{{take:25,skip:{},playerList:ALL}}) {{ id endDateTime durationSeconds didRadiantWin gameMode lobbyType rank players {{ steamAccountId steamAccount {{ name }} heroId isRadiant kills deaths assists goldPerMinute experiencePerMinute role position numLastHits numDenies networth heroDamage towerDamage heroHealing imp }} }} }} }}", request.id, request.offset)
}
pub fn page(row: &Value, request: &Request) -> Result<Value> {
    if row["steamAccountId"]
        .as_u64()
        .map(|v| v.to_string())
        .as_deref()
        != Some(&request.id)
    {
        return Err("upstream profile identity unavailable".into());
    }
    let raw = row["matches"].as_array();
    let private = row["steamAccount"]["isAnonymous"] == true;
    let mut matches = Vec::new();
    let mut rejected = 0;
    for m in raw.into_iter().flatten() {
        let parsed = (|| {
            let id = m["id"].as_u64().filter(|v| *v > 0)?;
            let end = m["endDateTime"].as_i64()?;
            let duration = m["durationSeconds"]
                .as_i64()
                .filter(|v| *v > 0 && *v <= 86400)?;
            if end < duration || end > chrono::Utc::now().timestamp() + 300 {
                return None;
            }
            let players: Vec<_> = m["players"]
                .as_array()?
                .iter()
                .filter(|p| p["steamAccountId"] == row["steamAccountId"])
                .collect();
            if players.len() != 1 {
                return None;
            }
            let p = players[0];
            let radiant = p["isRadiant"].as_bool()?;
            let (allies, enemies) = participants(&m["players"], &request.id, radiant);
            let lineup = lineup(&m["players"], &request.id);
            let (team_kills, team_deaths) =
                team_totals(&m["players"], "isRadiant", radiant).unzip();
            let mut row = json!({"allies":allies,"enemies":enemies,"lineup":lineup,"team_kills":team_kills,"team_deaths":team_deaths,"match_id":id,"hero_id":p["heroId"].as_u64().filter(|id| *id > 0)?,"start_time":end-duration,"duration":duration,"radiant_win":m["didRadiantWin"],"player_slot":if p["isRadiant"].as_bool()? {0} else {128},"kills":p["kills"],"deaths":p["deaths"],"assists":p["assists"],"gold_per_min":p["goldPerMinute"],"xp_per_min":p["experiencePerMinute"],"role":p["role"],"position":p["position"],"last_hits":p["numLastHits"],"denies":p["numDenies"],"net_worth":p["networth"],"hero_damage":p["heroDamage"],"tower_damage":p["towerDamage"],"hero_healing":p["heroHealing"],"imp":p["imp"],"game_mode":crate::stats::mode(&m["gameMode"]),"lobby_type":crate::stats::lobby(&m["lobbyType"])});
            if let Some(rank) = rank_tier(&m["rank"]) {
                row["average_rank"] = json!(rank);
            }
            Some(row)
        })();
        if let Some(m) = parsed {
            matches.push(m);
        } else {
            rejected += 1;
        }
    }
    let count = raw.map_or(0, Vec::len);
    let mut profile = json!({"rank_tier":row["steamAccount"]["seasonRank"],"leaderboard_rank":row["steamAccount"]["seasonLeaderboardRank"],"profile":{"account_id":row["steamAccountId"],"personaname":row["steamAccount"]["name"]}});
    if let Some(avatar) = row["steamAccount"]["avatar"].as_str() {
        profile["profile"]["avatarfull"] = json!(avatar);
    }
    if let Some(country) = crate::stats::country(&row["steamAccount"]["countryCode"]) {
        profile["profile"]["loccountrycode"] = json!(country);
    }
    Ok(
        json!({"accountId":request.id,"source":"STRATZ","fetchedAt":now(),"profile":profile,"matches":matches,"nextOffset":request.offset + count as u32,"hasMore":count == 25 && request.offset + (count as u32) <= 5000 && !private,"historyUnavailable":private || raw.is_none(),"stale":false,"warning":if private {Some("STRATZ history is private. Showing previously saved matches.")} else if raw.is_none() {Some("STRATZ returned no history. Showing saved matches.")} else if rejected > 0 {Some("Some matches were skipped because their data was incomplete.")} else {None}}),
    )
}
/// A medal and star (11–75) or Immortal (80); anything else is not a rank tier. STRATZ also
/// rounds a match rank to a medal without stars (50), kept as such.
pub fn rank_tier(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .filter(|v| *v == 80 || ((1..=7).contains(&(v / 10)) && v % 10 <= 5))
}
/// Kills and deaths of one team, summed over its five players (anonymous ones included),
/// for kill and death participation; `None` unless all five report both. `side` names the
/// team flag of a player row.
pub fn team_totals(players: &Value, side: &str, radiant: bool) -> Option<(u64, u64)> {
    let team: Vec<_> = players
        .as_array()?
        .iter()
        .filter(|p| p[side].as_bool() == Some(radiant))
        .collect();
    if team.len() != 5 {
        return None;
    }
    team.iter().try_fold((0, 0), |(kills, deaths), p| {
        Some((kills + p["kills"].as_u64()?, deaths + p["deaths"].as_u64()?))
    })
}
/// Other players of a match with a public account, split by the own team (for "already
/// met" and the player card): account, name, hero and K/D/A, absent fields omitted. Anonymous players have no usable
/// account and are left out, not counted.
pub fn participants(players: &Value, own: &str, own_radiant: bool) -> (Vec<Value>, Vec<Value>) {
    let (mut allies, mut enemies) = (vec![], vec![]);
    for p in players.as_array().into_iter().flatten() {
        let Some(id) = p["steamAccountId"]
            .as_u64()
            .and_then(|id| account_id(&id.to_string()).ok())
            .filter(|id| id != own && id != "4294967295")
            .and_then(|id| id.parse::<u32>().ok())
        else {
            continue;
        };
        let mut entry = json!({"id": id});
        if let Some(name) = p["steamAccount"]["name"]
            .as_str()
            .filter(|name| !name.is_empty())
        {
            entry["name"] = json!(name);
        }
        for (from, to) in [
            ("heroId", "hero"),
            ("kills", "kills"),
            ("deaths", "deaths"),
            ("assists", "assists"),
        ] {
            if let Some(value) = p[from].as_u64() {
                entry[to] = json!(value);
            }
        }
        match p["isRadiant"].as_bool() {
            Some(radiant) if radiant == own_radiant => allies.push(entry),
            Some(_) => enemies.push(entry),
            None => {}
        }
    }
    (allies, enemies)
}
/// Every player of a match with their statistics, for comparing the own numbers with the
/// other nine: side, hero, K/D/A, economy, damage, IMP and position, absent fields omitted.
/// Only public accounts keep an id and name; anonymous players keep hero and numbers. The
/// own row is marked. At most ten entries, in the order STRATZ lists them.
pub fn lineup(players: &Value, own: &str) -> Vec<Value> {
    let mut rows = Vec::new();
    for p in players.as_array().into_iter().flatten().take(10) {
        let Some(radiant) = p["isRadiant"].as_bool() else {
            continue;
        };
        let mut entry = json!({"radiant": radiant});
        let account = p["steamAccountId"]
            .as_u64()
            .and_then(|id| account_id(&id.to_string()).ok())
            .filter(|id| id != "4294967295");
        if account.as_deref() == Some(own) {
            entry["own"] = json!(true);
        } else if let Some(id) = account.and_then(|id| id.parse::<u32>().ok()) {
            entry["id"] = json!(id);
            if let Some(name) = p["steamAccount"]["name"]
                .as_str()
                .filter(|name| !name.is_empty())
            {
                entry["name"] = json!(name);
            }
        }
        for (from, to) in [
            ("heroId", "hero_id"),
            ("kills", "kills"),
            ("deaths", "deaths"),
            ("assists", "assists"),
            ("goldPerMinute", "gold_per_min"),
            ("experiencePerMinute", "xp_per_min"),
            ("numLastHits", "last_hits"),
            ("numDenies", "denies"),
            ("networth", "net_worth"),
            ("heroDamage", "hero_damage"),
            ("towerDamage", "tower_damage"),
            ("heroHealing", "hero_healing"),
        ] {
            if let Some(value) = p[from].as_u64() {
                entry[to] = json!(value);
            }
        }
        if let Some(imp) = p["imp"].as_i64() {
            entry["imp"] = json!(imp);
        }
        if let Some(position) = p["position"].as_str().filter(|v| v.len() <= 40) {
            entry["position"] = json!(position);
        }
        rows.push(entry);
    }
    rows
}
pub fn merge(previous: Option<&Value>, mut page: Value) -> Value {
    let previous =
        previous.filter(|v| v["accountId"] == page["accountId"] && v["source"] == page["source"]);
    let mut rows = BTreeMap::new();
    for source in [previous, Some(&page)].into_iter().flatten() {
        for row in source["matches"].as_array().into_iter().flatten() {
            if let Some(id) = row["match_id"].as_u64() {
                rows.insert(id, row.clone());
            }
        }
    }
    let mut matches: Vec<_> = rows.into_values().collect();
    matches.sort_by_key(|m| {
        std::cmp::Reverse((
            m["start_time"].as_i64().unwrap_or(0),
            m["match_id"].as_u64().unwrap_or(0),
        ))
    });
    matches.truncate(10000);
    page["matches"] = json!(matches);
    if let Some(old) = previous {
        // Missing fields must not erase a previously known identity or medal.
        for key in ["rank_tier", "leaderboard_rank"] {
            if page["profile"][key].is_null() {
                page["profile"][key] = old["profile"][key].clone();
            }
        }
        for key in ["personaname", "avatarfull", "loccountrycode"] {
            if page["profile"]["profile"][key]
                .as_str()
                .is_none_or(str::is_empty)
                && !old["profile"]["profile"][key].is_null()
            {
                page["profile"]["profile"][key] = old["profile"]["profile"][key].clone();
            }
        }
    }
    page
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn history_requests_and_preserves_position_without_guessing_missing_values() {
        let request = Request {
            id: "1".into(),
            offset: 0,
        };
        assert!(query(&request).contains("role position"));
        assert!(query(&request).contains("avatar countryCode"));
        assert!(query(&request).contains("players { steamAccountId steamAccount { name } heroId"));
        // SINGLE returns only the requested player; teammates and opponents need ALL.
        assert!(query(&request).contains("playerList:ALL"));
        for position in [
            json!("POSITION_1"),
            json!("POSITION_2"),
            json!("POSITION_3"),
            json!("POSITION_4"),
            json!("POSITION_5"),
            Value::Null,
        ] {
            let row = json!({"steamAccountId":1,"matches":[{"id":10,"endDateTime":1700000000,"durationSeconds":1800,
                "players":[{"steamAccountId":1,"heroId":1,"isRadiant":true,"role":"CORE","position":position}]}]});
            let result = page(&row, &request).unwrap();
            assert_eq!(result["matches"][0]["position"], position);
            assert_eq!(result["matches"][0]["role"], "CORE");
            // Absent economy fields stay null rather than becoming zero.
            assert!(result["matches"][0]["net_worth"].is_null());
        }
        assert!(query(&request)
            .contains("numLastHits numDenies networth heroDamage towerDamage heroHealing imp"));
        let row = json!({"steamAccountId":1,"matches":[{"id":10,"endDateTime":1700000000,"durationSeconds":1800,
            "players":[{"steamAccountId":1,"heroId":1,"isRadiant":true,"numLastHits":163,"numDenies":3,"networth":70000,
            "heroDamage":92100,"towerDamage":8400,"heroHealing":0,"imp":12}]}]});
        let m = &page(&row, &request).unwrap()["matches"][0];
        assert_eq!(
            [
                &m["last_hits"],
                &m["denies"],
                &m["net_worth"],
                &m["hero_damage"],
                &m["tower_damage"],
                &m["hero_healing"],
                &m["imp"]
            ],
            [
                &json!(163),
                &json!(3),
                &json!(70000),
                &json!(92100),
                &json!(8400),
                &json!(0),
                &json!(12)
            ]
        );
    }
    #[test]
    fn history_keeps_a_valid_match_rank_only() {
        let request = Request {
            id: "1".into(),
            offset: 0,
        };
        // STRATZ leaves averageRank empty; `rank` holds the match's medal and stars.
        assert!(query(&request).contains("lobbyType rank players"));
        let rank = |value: Value| {
            let row = json!({"steamAccountId":1,"matches":[{"id":10,"endDateTime":1700000000,"durationSeconds":1800,
                "rank":value,"players":[{"steamAccountId":1,"heroId":1,"isRadiant":true}]}]});
            page(&row, &request).unwrap()["matches"][0]
                .get("average_rank")
                .cloned()
        };
        assert_eq!(rank(json!(75)), Some(json!(75)));
        assert_eq!(rank(json!(80)), Some(json!(80)));
        assert_eq!(rank(json!(11)), Some(json!(11)));
        // Live values include a medal without stars (50, 70).
        assert_eq!(rank(json!(70)), Some(json!(70)));
        assert_eq!(rank(json!(10)), Some(json!(10)));
        // Not a medal and star: left out rather than guessed.
        for value in [
            json!(0),
            Value::Null,
            json!(95),
            json!(76),
            json!(81),
            json!(85),
            json!(9),
        ] {
            assert_eq!(rank(value.clone()), None, "{value}");
        }
        let row = json!({"steamAccountId":1,"matches":[{"id":10,"endDateTime":1700000000,"durationSeconds":1800,
            "players":[{"steamAccountId":1,"heroId":1,"isRadiant":true}]}]});
        assert!(page(&row, &request).unwrap()["matches"][0]
            .get("average_rank")
            .is_none());
    }
    #[test]
    fn team_totals_need_all_five_players_of_the_team() {
        let player = |radiant: bool, kills: u64, deaths: u64| json!({"isRadiant":radiant,"kills":kills,"deaths":deaths});
        let mut players: Vec<_> = (0..5).map(|i| player(true, i, 1)).collect();
        players.extend((0..5).map(|_| player(false, 2, 3)));
        assert_eq!(
            team_totals(&json!(players), "isRadiant", true),
            Some((10, 5))
        );
        assert_eq!(
            team_totals(&json!(players), "isRadiant", false),
            Some((10, 15))
        );
        players[0]["deaths"] = Value::Null;
        assert_eq!(team_totals(&json!(players), "isRadiant", true), None);
        assert_eq!(
            team_totals(&json!(players[1..].to_vec()), "isRadiant", false),
            Some((10, 15))
        );
        assert_eq!(
            team_totals(&json!(players[5..].to_vec()), "isRadiant", true),
            None
        );
    }
    #[test]
    fn participants_are_kept_by_team_without_the_player_or_anonymous_accounts() {
        let request = Request {
            id: "1".into(),
            offset: 0,
        };
        let row = json!({"steamAccountId":1,"matches":[{"id":10,"endDateTime":1700000000,"durationSeconds":1800,
            "players":[{"steamAccountId":1,"heroId":1,"isRadiant":true},{"steamAccountId":2,"steamAccount":{"name":"Two"},"isRadiant":true,"heroId":14,"kills":3,"deaths":0,"assists":9},
                {"steamAccountId":null,"isRadiant":true},{"steamAccountId":4294967295u64,"isRadiant":false},
                {"steamAccountId":3,"isRadiant":false},{"steamAccountId":4}]}]});
        let m = &page(&row, &request).unwrap()["matches"][0];
        assert_eq!(
            (&m["allies"], &m["enemies"]),
            (
                &json!([{"id":2,"name":"Two","hero":14,"kills":3,"deaths":0,"assists":9}]),
                &json!([{"id":3}])
            )
        );
    }
    #[test]
    fn lineup_keeps_every_player_and_identity_only_for_public_accounts() {
        let request = Request {
            id: "1".into(),
            offset: 0,
        };
        let mut players = vec![
            json!({"steamAccountId":1,"heroId":1,"isRadiant":true,"kills":5,"deaths":2,"assists":7,"goldPerMinute":610,"imp":-4,"position":"POSITION_1"}),
            json!({"steamAccountId":2,"steamAccount":{"name":"Two"},"heroId":14,"isRadiant":true,"heroDamage":15000,"heroHealing":0}),
            json!({"steamAccountId":null,"steamAccount":{"name":"Hidden"},"heroId":8,"isRadiant":false,"kills":9}),
            json!({"steamAccountId":4294967295u64,"heroId":9,"isRadiant":false}),
            json!({"steamAccountId":5,"heroId":10}),
        ];
        players.extend((0..8).map(|i| json!({"heroId":20 + i,"isRadiant":i % 2 == 0})));
        let row = json!({"steamAccountId":1,"matches":[{"id":10,"endDateTime":1700000000,"durationSeconds":1800,"players":players}]});
        let lineup = page(&row, &request).unwrap()["matches"][0]["lineup"].clone();
        let lineup = lineup.as_array().unwrap();
        // Ten listed players at most; a row without a side is dropped, not guessed.
        assert_eq!(lineup.len(), 9);
        assert_eq!(
            lineup[0],
            json!({"radiant":true,"own":true,"hero_id":1,"kills":5,"deaths":2,"assists":7,"gold_per_min":610,"imp":-4,"position":"POSITION_1"})
        );
        assert_eq!(
            lineup[1],
            json!({"radiant":true,"id":2,"name":"Two","hero_id":14,"hero_damage":15000,"hero_healing":0})
        );
        // Anonymous players keep their hero and numbers but no identity.
        assert_eq!(lineup[2], json!({"radiant":false,"hero_id":8,"kills":9}));
        assert_eq!(lineup[3], json!({"radiant":false,"hero_id":9}));
        assert!(lineup
            .iter()
            .all(|p| p.get("name").is_none() || p["id"].is_u64()));
    }
    #[test]
    fn pagination_counts_raw_rows_and_checks_identity() {
        let mut request = Request {
            id: "76561197960265729".into(),
            offset: 25,
        };
        request.validate().unwrap();
        assert_eq!(request.id, "1");
        assert!(query(&request).contains("skip:25"));
        let row = json!({"steamAccountId":1,"matches":vec![json!({"id":123});25]});
        let out = page(&row, &request).unwrap();
        assert_eq!(out["nextOffset"], 50);
        assert_eq!(out["hasMore"], true);
        assert_eq!(out["matches"].as_array().unwrap().len(), 0);
        assert!(page(&json!({"steamAccountId":2}), &request).is_err());
        assert!(serde_json::from_value::<Request>(json!({"id":"1","query":"arbitrary"})).is_err());
        assert!(Request {
            id: "1".into(),
            offset: 5001
        }
        .validate()
        .is_err());
    }
    #[test]
    fn merging_preserves_history_on_private_response_and_isolates_accounts() {
        let old = json!({"accountId":"1","source":"STRATZ","profile":{"rank_tier":54,"profile":{"personaname":"Known","loccountrycode":"SE"}},"matches":[{"match_id":1,"start_time":10},{"match_id":2,"start_time":20}]});
        let page = page(
            &json!({"steamAccountId":1,"steamAccount":{"isAnonymous":true}}),
            &Request {
                id: "1".into(),
                offset: 0,
            },
        )
        .unwrap();
        let out = merge(Some(&old), page);
        assert_eq!(out["matches"].as_array().unwrap().len(), 2);
        assert_eq!(out["profile"]["rank_tier"], 54);
        assert_eq!(out["profile"]["profile"]["loccountrycode"], "SE");
        assert_eq!(out["historyUnavailable"], true);
        let new = json!({"accountId":"1","source":"STRATZ","profile":{"profile":{}},"matches":[{"match_id":2,"start_time":20,"kills":7},{"match_id":3,"start_time":30}]});
        let out = merge(Some(&old), new.clone());
        assert_eq!(out["matches"].as_array().unwrap().len(), 3);
        assert_eq!(out["matches"][1]["kills"], 7);
        assert_eq!(
            merge(Some(&json!({"accountId":"2"})), new)["matches"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }
}
