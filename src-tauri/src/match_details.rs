//! One match by its ID from STRATZ or OpenDota, reduced to the same shape: per player the
//! team, hero, account (when public) and history field names. It fills in what GSI cannot
//! send for a recorded match, and works when the account's own match history is private,
//! because only the account is hidden in a match, not the statistics of its slot.
use crate::store::Result;
use serde_json::{json, Map, Value};

/// Player statistics in history field names, from (STRATZ, OpenDota) field names.
const FIELDS: [(&str, &str, &str); 11] = [
    ("kills", "kills", "kills"),
    ("deaths", "deaths", "deaths"),
    ("assists", "assists", "assists"),
    ("numLastHits", "last_hits", "last_hits"),
    ("numDenies", "denies", "denies"),
    ("networth", "net_worth", "net_worth"),
    ("heroDamage", "hero_damage", "hero_damage"),
    ("towerDamage", "tower_damage", "tower_damage"),
    ("heroHealing", "hero_healing", "hero_healing"),
    ("goldPerMinute", "gold_per_min", "gold_per_min"),
    ("experiencePerMinute", "xp_per_min", "xp_per_min"),
];
pub const ANONYMOUS: u64 = 4294967295;

pub fn match_id(input: &str) -> Result<u64> {
    input
        .parse::<u64>()
        .ok()
        .filter(|id| *id > 0 && id.to_string().len() <= 12)
        .ok_or_else(|| "Invalid match ID".into())
}
pub fn stratz_query(id: u64) -> String {
    format!("{{ match(id:{id}) {{ id gameMode lobbyType rank players {{ steamAccountId heroId isRadiant kills deaths assists numLastHits numDenies networth heroDamage towerDamage heroHealing goldPerMinute experiencePerMinute imp role position }} }} }}")
}

fn player(radiant: Option<bool>, hero: &Value, account: &Value) -> Option<Map<String, Value>> {
    let mut row = Map::new();
    row.insert("radiant".into(), json!(radiant?));
    row.insert("hero_id".into(), json!(hero.as_u64().filter(|id| *id > 0)?));
    if let Some(id) = account.as_u64().filter(|id| *id > 0 && *id != ANONYMOUS) {
        row.insert("account".into(), json!(id));
    }
    Some(row)
}
fn shape(id: u64, source: &str, mode: i64, lobby: i64, players: Vec<Value>) -> Result<Value> {
    // A match always has ten players; fewer means a partial or foreign response.
    if players.len() != 10 {
        return Err(format!("{source}: incomplete match data"));
    }
    let mut value = json!({"match_id":id,"source":source,"players":players});
    if mode >= 0 {
        value["game_mode"] = json!(mode);
    }
    if lobby >= 0 {
        value["lobby_type"] = json!(lobby);
    }
    Ok(value)
}

pub fn from_stratz(id: u64, m: &Value) -> Result<Value> {
    if m["id"].as_u64() != Some(id) {
        return Err("STRATZ: match unavailable".into());
    }
    let players = m["players"].as_array().ok_or("STRATZ: match unavailable")?;
    let players = players
        .iter()
        .filter_map(|p| {
            let mut row = player(p["isRadiant"].as_bool(), &p["heroId"], &p["steamAccountId"])?;
            for (from, to, _) in FIELDS {
                if let Some(v) = p[from].as_u64() {
                    row.insert(to.into(), json!(v));
                }
            }
            // IMP is computed once STRATZ has processed the match; until then it is absent.
            if let Some(imp) = p["imp"].as_i64() {
                row.insert("imp".into(), json!(imp));
            }
            if let Some(position) = p["position"].as_str().filter(|v| {
                matches!(
                    *v,
                    "POSITION_1" | "POSITION_2" | "POSITION_3" | "POSITION_4" | "POSITION_5"
                )
            }) {
                row.insert("position".into(), json!(position));
            }
            if let Some(role) = p["role"].as_str().filter(|v| v.len() <= 32) {
                row.insert("role".into(), json!(role));
            }
            Some(Value::Object(row))
        })
        .collect();
    let mut value = shape(
        id,
        "STRATZ",
        crate::stats::mode(&m["gameMode"]),
        crate::stats::lobby(&m["lobbyType"]),
        players,
    )?;
    if let Some(rank) = crate::history::rank_tier(&m["rank"]) {
        value["average_rank"] = json!(rank);
    }
    Ok(value)
}

pub fn from_opendota(id: u64, m: &Value) -> Result<Value> {
    if m["match_id"].as_u64() != Some(id) {
        return Err("OpenDota: match unavailable".into());
    }
    let players = m["players"]
        .as_array()
        .ok_or("OpenDota: match unavailable")?;
    let players = players
        .iter()
        .filter_map(|p| {
            let radiant = p["player_slot"].as_u64().map(|slot| slot < 128);
            let mut row = player(radiant, &p["hero_id"], &p["account_id"])?;
            for (_, to, from) in FIELDS {
                if let Some(v) = p[from].as_u64() {
                    row.insert(to.into(), json!(v));
                }
            }
            // Only a parsed replay has a lane; 1 safe, 2 mid, 3 off, 4 jungle.
            if let Some(lane) = p["lane_role"].as_u64().filter(|v| (1..=4).contains(v)) {
                row.insert("lane_role".into(), json!(lane));
            }
            Some(Value::Object(row))
        })
        .collect();
    shape(
        id,
        "OpenDota",
        m["game_mode"].as_i64().unwrap_or(-1),
        m["lobby_type"].as_i64().unwrap_or(-1),
        players,
    )
}

/// The recorded player in a match: same team and hero (heroes are unique within a match),
/// and not a different public account.
pub fn own<'a>(record: &Value, details: &'a Value) -> Option<&'a Value> {
    if details["match_id"] != record["match_id"] {
        return None;
    }
    let radiant = record["player_slot"].as_u64()? < 128;
    let account = record["accountId"].as_str()?.parse::<u64>().ok()?;
    let found: Vec<_> = details["players"]
        .as_array()?
        .iter()
        .filter(|p| p["radiant"] == radiant && p["hero_id"] == record["hero_id"])
        .collect();
    match found.as_slice() {
        [p] if p["account"].is_null() || p["account"] == account => Some(p),
        _ => None,
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A ten-player OpenDota match where the own player (account 7) is Dire slot 3 on hero 75.
    pub fn opendota() -> Value {
        let mut players: Vec<Value> = (0..10)
            .map(|i: u64| {
                let slot = if i < 5 { i } else { 128 + i - 5 };
                json!({"player_slot":slot,"hero_id":i + 1,"account_id":if i % 2 == 0 {json!(100 + i)} else {Value::Null},
                    "kills":i,"deaths":2,"assists":3,"last_hits":40,"denies":2,"net_worth":9000,"hero_damage":12000,
                    "tower_damage":300,"hero_healing":0,"gold_per_min":400,"xp_per_min":500})
            })
            .collect();
        players[8]["hero_id"] = json!(75);
        players[8]["account_id"] = json!(7);
        players[8]["lane_role"] = json!(9);
        players[2]["lane_role"] = json!(2);
        json!({"match_id":42,"game_mode":22,"lobby_type":7,"players":players})
    }
    pub fn record() -> Value {
        json!({"accountId":"7","match_id":42,"hero_id":75,"player_slot":131,"kills":8,"deaths":2,"assists":3})
    }

    #[test]
    fn opendota_match_keeps_slots_heroes_and_public_accounts_only() {
        let m = from_opendota(42, &opendota()).unwrap();
        assert_eq!(m["source"], "OpenDota");
        assert_eq!((&m["game_mode"], &m["lobby_type"]), (&json!(22), &json!(7)));
        let p = &m["players"];
        assert_eq!(p.as_array().unwrap().len(), 10);
        assert_eq!(
            (&p[0]["radiant"], &p[5]["radiant"]),
            (&json!(true), &json!(false))
        );
        assert!(p[1]["account"].is_null());
        assert_eq!(p[2]["lane_role"], 2);
        assert!(
            p[8]["lane_role"].is_null(),
            "unknown lane codes are dropped"
        );
        assert_eq!(p[8]["hero_damage"], 12000);
        assert!(from_opendota(41, &opendota()).is_err());
        let mut short = opendota();
        short["players"].as_array_mut().unwrap().pop();
        assert!(from_opendota(42, &short).is_err());
    }

    #[test]
    fn stratz_match_maps_imp_position_and_named_modes() {
        let players: Vec<Value> = (0..10u64)
            .map(|i| json!({"steamAccountId":if i == 0 {json!(ANONYMOUS)} else {json!(i)},"heroId":i + 1,"isRadiant":i < 5,
                "kills":1,"numLastHits":50,"networth":7000,"imp":if i == 1 {json!(-12)} else {Value::Null},
                "position":if i == 1 {"POSITION_4"} else {"UNKNOWN"},"role":"LIGHT_SUPPORT"}))
            .collect();
        let m = from_stratz(
            42,
            &json!({"id":42,"gameMode":"ALL_PICK_RANKED","lobbyType":"RANKED","rank":72,"players":players.clone()}),
        )
        .unwrap();
        assert_eq!((&m["game_mode"], &m["lobby_type"]), (&json!(22), &json!(7)));
        // The match's rank tier, as in the history; anything else is left out.
        assert_eq!(m["average_rank"], 72);
        let unranked = from_stratz(42, &json!({"id":42,"rank":0,"players":players})).unwrap();
        assert!(unranked.get("average_rank").is_none());
        let p = &m["players"];
        assert!(
            p[0]["account"].is_null(),
            "the anonymous marker is not an account"
        );
        assert_eq!(
            (&p[1]["imp"], &p[1]["position"]),
            (&json!(-12), &json!("POSITION_4"))
        );
        assert!(p[0]["imp"].is_null() && p[0]["position"].is_null());
        assert_eq!(
            (&p[1]["last_hits"], &p[1]["net_worth"]),
            (&json!(50), &json!(7000))
        );
        assert!(from_stratz(42, &json!({"id":43,"players":[]})).is_err());
        assert!(stratz_query(42).contains("match(id:42)"));
        assert!(stratz_query(42).contains(" rank "));
    }

    #[test]
    fn the_own_player_is_found_by_team_and_hero_and_never_a_different_account() {
        let m = from_opendota(42, &opendota()).unwrap();
        assert_eq!(own(&record(), &m).unwrap()["account"], 7);
        let mut other = m.clone();
        other["players"][8]["account"] = json!(8);
        assert!(own(&record(), &other).is_none());
        other["players"][8]["account"] = Value::Null;
        assert!(
            own(&record(), &other).is_some(),
            "an anonymous slot still matches"
        );
        let mut radiant = record();
        radiant["player_slot"] = json!(3);
        assert!(own(&radiant, &m).is_none());
        let mut foreign = record();
        foreign["match_id"] = json!(41);
        assert!(own(&foreign, &m).is_none());
        assert!(match_id("0").is_err() && match_id("x").is_err());
    }
}
