use crate::store::Result;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashSet;

/// STRATZ basic rank brackets accepted by hero statistics and matchups; `ALL` sends no
/// filter. Immortal alone is not offered: these queries only take the basic brackets.
pub const BRACKETS: [&str; 5] = [
    "ALL",
    "HERALD_GUARDIAN",
    "CRUSADER_ARCHON",
    "LEGEND_ANCIENT",
    "DIVINE_IMMORTAL",
];
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub ids: Vec<u64>,
    /// One of `BRACKETS`; absent (older clients) means all ranks.
    #[serde(default)]
    pub bracket: Option<String>,
}
impl Request {
    pub fn bracket(&self) -> Result<&str> {
        valid_bracket(self.bracket.as_deref().unwrap_or("ALL"))
    }
}
pub fn valid_bracket(bracket: &str) -> Result<&str> {
    if BRACKETS.contains(&bracket) {
        Ok(bracket)
    } else {
        Err("Invalid rank bracket".into())
    }
}
pub fn validate_ids(ids: &[u64]) -> Result<()> {
    if ids.len() > 10
        || ids.iter().any(|id| *id == 0 || *id > 1000)
        || ids.iter().collect::<HashSet<_>>().len() != ids.len()
    {
        return Err("Invalid hero IDs".into());
    }
    Ok(())
}

fn hero_id(value: &Value) -> Option<u64> {
    value.as_u64().filter(|id| (1..=1000).contains(id))
}
fn valid_counts(row: &Value) -> bool {
    matches!((row["matchCount"].as_u64(), row["winCount"].as_u64()),
        (Some(games), Some(wins)) if wins <= games && games <= 9_007_199_254_740_991)
}

/// Check returned rows before committing any part of a query result to cache.
/// Missing heroes, empty pair arrays and null synergy are missing evidence, not zero advantage.
pub fn validate_data(data: &Value, ids: &[u64], positions: bool) -> Result<()> {
    let invalid = "Invalid or incomplete STRATZ draft data";
    if positions {
        let rows = data["positions"].as_array().ok_or(invalid)?;
        if rows.is_empty() || rows.len() > 5000 {
            return Err(invalid.into());
        }
        let mut seen = HashSet::new();
        for row in rows {
            let id = hero_id(&row["heroId"]).ok_or(invalid)?;
            let position = row["position"].as_str().ok_or(invalid)?;
            if !matches!(
                position,
                "POSITION_1" | "POSITION_2" | "POSITION_3" | "POSITION_4" | "POSITION_5"
            ) || !valid_counts(row)
                || !seen.insert((id, position))
            {
                return Err(invalid.into());
            }
        }
    }
    if ids.is_empty() && data.get("matchups").is_none() {
        return Ok(());
    }
    let rows = data["matchups"].as_array().ok_or(invalid)?;
    let mut seen = HashSet::new();
    for row in rows {
        let id = hero_id(&row["heroId"]).ok_or(invalid)?;
        if !ids.contains(&id) || !seen.insert(id) {
            return Err(invalid.into());
        }
        for field in ["vs", "with"] {
            let pairs = row[field].as_array().ok_or(invalid)?;
            if pairs.len() > 1000 {
                return Err(invalid.into());
            }
            let mut opponents = HashSet::new();
            for pair in pairs {
                let opponent = hero_id(&pair["heroId2"]).ok_or(invalid)?;
                if pair["heroId1"].as_u64() != Some(id)
                    || !opponents.insert(opponent)
                    || !valid_counts(pair)
                    || !(pair["synergy"].is_null()
                        || pair["synergy"].as_f64().is_some_and(f64::is_finite))
                {
                    return Err(invalid.into());
                }
            }
        }
    }
    Ok(())
}

pub fn validate_response(data: &Value, ids: &[u64], bracket: &str) -> Result<()> {
    validate_ids(ids)?;
    // A service without brackets answers for all ranks only.
    if data["bracket"].as_str().unwrap_or("ALL") != bracket {
        return Err("The statistics service does not support rank brackets; update it".into());
    }
    if data["source"] != "STRATZ"
        || !data["fetchedAt"]
            .as_str()
            .is_some_and(|s| chrono::DateTime::parse_from_rfc3339(s).is_ok())
    {
        return Err("Invalid draft service response".into());
    }
    validate_data(data, ids, true)
}
pub fn query(ids: &[u64], positions: bool, bracket: &str) -> String {
    let filter = if bracket == "ALL" {
        String::new()
    } else {
        format!(",bracketBasicIds:[{bracket}]")
    };
    let positions = if positions {
        format!("positions:stats(groupByPosition:true,groupByTime:false,groupByBracket:false{filter}) {{ heroId position week matchCount winCount }}")
    } else {
        String::new()
    };
    let matchups = if ids.is_empty() {
        String::new()
    } else {
        format!("matchups:matchUp(heroIds:[{}],take:150{filter}) {{ heroId vs {{ heroId1 heroId2 matchCount winCount synergy }} with {{ heroId1 heroId2 matchCount winCount synergy }} }}", ids.iter().map(u64::to_string).collect::<Vec<_>>().join(","))
    };
    format!("{{ heroStats {{ {positions} {matchups} }} }}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn data() -> Value {
        json!({"source":"STRATZ","fetchedAt":"2026-10-13T00:00:00Z",
            "positions":[{"heroId":3,"position":"POSITION_5","matchCount":1000,"winCount":500}],
            "matchups":[{"heroId":1,"vs":[{"heroId1":1,"heroId2":3,"matchCount":1000,"winCount":500,"synergy":-2}],"with":[]},
                        {"heroId":2,"vs":[],"with":[]}]})
    }
    #[test]
    fn draft_response_requires_valid_unambiguous_rows() {
        let original = data();
        validate_response(&original, &[2, 1], "ALL").unwrap();
        for pointer in [
            "/positions/0/position",
            "/matchups/0/vs",
            "/matchups/0/with",
            "/positions/0/matchCount",
        ] {
            let mut bad = original.clone();
            *bad.pointer_mut(pointer).unwrap() = Value::Null;
            assert!(
                validate_response(&bad, &[1, 2], "ALL").is_err(),
                "{pointer}"
            );
        }
        for (pointer, replacement) in [
            ("/matchups/0/heroId", json!(2)),
            ("/matchups/0/heroId", json!(99)),
            ("/positions", json!([])),
            ("/matchups/0/vs/0/heroId1", json!(2)),
            ("/matchups/0/vs/0/heroId2", json!(1001)),
            ("/matchups/0/vs/0/synergy", json!("-2")),
            ("/matchups/0/vs/0/matchCount", json!(100.5)),
            ("/matchups/0/vs/0/winCount", json!(1001)),
            ("/positions/0/winCount", json!(-1)),
            ("/source", json!("OpenDota")),
            ("/fetchedAt", json!("yesterday")),
        ] {
            let mut bad = original.clone();
            *bad.pointer_mut(pointer).unwrap() = replacement;
            assert!(
                validate_response(&bad, &[1, 2], "ALL").is_err(),
                "{pointer}"
            );
        }
        let mut missing = original.clone();
        missing["matchups"].as_array_mut().unwrap().pop();
        validate_response(&missing, &[1, 2], "ALL").unwrap();
        assert_eq!(missing["matchups"], json!([original["matchups"][0]]));
        missing["matchups"] = json!([]);
        validate_response(&missing, &[1, 2], "ALL").unwrap();
        assert!(validate_response(&original, &[], "ALL").is_err());
        for pointer in ["/positions", "/matchups/0/vs"] {
            let mut duplicate = original.clone();
            let rows = duplicate
                .pointer_mut(pointer)
                .unwrap()
                .as_array_mut()
                .unwrap();
            rows.push(rows[0].clone());
            assert!(validate_response(&duplicate, &[1, 2], "ALL").is_err());
        }
    }
    #[test]
    fn draft_missing_pair_evidence_is_not_an_invalid_payload_or_zero() {
        let mut value = data();
        value["matchups"][0]["vs"][0]["synergy"] = Value::Null;
        validate_response(&value, &[1, 2], "ALL").unwrap();
        assert!(value["matchups"][0]["vs"][0]["synergy"].is_null());
        value["matchups"][0]["vs"][0]["synergy"] = json!(666);
        validate_response(&value, &[1, 2], "ALL").unwrap();
        value["matchups"][0]["vs"] = json!([]);
        validate_response(&value, &[1, 2], "ALL").unwrap();
    }
    #[test]
    fn rank_bracket_filters_positions_and_matchups() {
        let all = query(&[1, 2], true, "ALL");
        assert!(!all.contains("bracketBasicIds"));
        let top = query(&[1, 2], true, "DIVINE_IMMORTAL");
        assert!(top.contains("groupByBracket:false,bracketBasicIds:[DIVINE_IMMORTAL])"));
        assert!(top.contains("matchUp(heroIds:[1,2],take:150,bracketBasicIds:[DIVINE_IMMORTAL])"));
        assert!(valid_bracket("IMMORTAL").is_err());
        assert!(valid_bracket("DIVINE_IMMORTAL]){ x }").is_err());
        let request: Request = serde_json::from_value(serde_json::json!({"ids":[1]})).unwrap();
        assert_eq!(request.bracket().unwrap(), "ALL");
        // The answer must be for the requested bracket; an old service answers for all ranks.
        let mut answer = data();
        assert!(validate_response(&answer, &[1, 2], "LEGEND_ANCIENT").is_err());
        answer["bracket"] = serde_json::json!("LEGEND_ANCIENT");
        validate_response(&answer, &[1, 2], "LEGEND_ANCIENT").unwrap();
    }
}
