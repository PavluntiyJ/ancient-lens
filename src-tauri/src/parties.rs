//! Recent teammates of a match roster, for party marks. STRATZ records a `partyId` for
//! many past matches but not for one in progress, so the service looks at each player's
//! latest matches and returns only which roster accounts shared a team and a party there.
use crate::store::{account_id, now, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;

/// Matches per player; enough to cover a few evenings of play.
const TAKE: u32 = 20;
/// Older matches say little about who queues together today.
const MAX_AGE: i64 = 90 * 24 * 3600;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub ids: Vec<String>,
}
impl Request {
    pub fn validate(&mut self) -> Result<()> {
        if !(2..=10).contains(&self.ids.len()) {
            return Err("Two to ten accounts required".into());
        }
        self.ids = self
            .ids
            .iter()
            .map(|id| account_id(id))
            .collect::<Result<Vec<_>>>()?;
        if self.ids.iter().collect::<HashSet<_>>().len() != self.ids.len() {
            return Err("Duplicate account".into());
        }
        Ok(())
    }
}

/// One alias per account: STRATZ refuses `take` above 5 for a batched `players(...)` with
/// every player of each match, but accepts it per player.
pub fn query(ids: &[String]) -> String {
    let players: String = ids
        .iter()
        .map(|id| format!(" p{id}: player(steamAccountId:{id}) {{ steamAccountId matches(request:{{take:{TAKE},playerList:ALL}}) {{ id startDateTime players {{ steamAccountId isRadiant partyId }} }} }}"))
        .collect();
    format!("{{{players} }}")
}

/// Each requested account's recent matches, keeping only the other requested accounts on
/// its team; `party` is true for the same STRATZ party, false for different ones, null when
/// STRATZ did not record it. No other account IDs leave the service.
pub fn reduce(data: &Value, ids: &[String], now_seconds: i64) -> Value {
    let requested: HashSet<u64> = ids.iter().filter_map(|id| id.parse().ok()).collect();
    let players: Vec<Value> = ids
        .iter()
        .map(|id| {
            let own: u64 = id.parse().unwrap_or(0);
            let matches: Vec<Value> = data[format!("p{id}")]["matches"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|m| {
                    let start = m["startDateTime"].as_i64()?;
                    if now_seconds - start > MAX_AGE {
                        return None;
                    }
                    let players = m["players"].as_array()?;
                    let me = players
                        .iter()
                        .find(|p| p["steamAccountId"].as_u64() == Some(own))?;
                    let side = me["isRadiant"].as_bool()?;
                    let mates: Vec<Value> = players
                        .iter()
                        .filter(|p| {
                            p["steamAccountId"]
                                .as_u64()
                                .is_some_and(|other| other != own && requested.contains(&other))
                                && p["isRadiant"].as_bool() == Some(side)
                        })
                        .map(|p| {
                            let party = match (me["partyId"].as_u64(), p["partyId"].as_u64()) {
                                (Some(a), Some(b)) => json!(a == b),
                                _ => Value::Null,
                            };
                            json!({"id":p["steamAccountId"].as_u64().unwrap_or(0).to_string(),"party":party})
                        })
                        .collect();
                    if mates.is_empty() {
                        return None;
                    }
                    Some(json!({"match_id":m["id"].as_u64()?,"start_time":start,"mates":mates}))
                })
                .collect();
            json!({"accountId":id,"matches":matches})
        })
        .collect();
    json!({"source":"STRATZ","fetchedAt":now(),"players":players})
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000;
    fn player(id: u64, radiant: bool, party: Option<u64>) -> Value {
        json!({"steamAccountId":id,"isRadiant":radiant,"partyId":party})
    }
    fn ids(list: &[&str]) -> Vec<String> {
        list.iter().map(|id| id.to_string()).collect()
    }

    #[test]
    fn query_aliases_every_account() {
        let query = query(&ids(&["1001", "1002"]));
        assert!(query.contains("p1001: player(steamAccountId:1001)"));
        assert!(query.contains("p1002: player(steamAccountId:1002)"));
        assert!(query.contains("take:20,playerList:ALL"));
        assert!(query.contains("partyId"));
    }

    #[test]
    fn reduce_keeps_only_requested_teammates() {
        let data = json!({"p1001":{"matches":[{"id":77,"startDateTime":NOW - 3600,"players":[
            player(1001, true, Some(1)),
            player(1002, true, Some(1)),
            player(1003, true, Some(2)),
            player(1004, true, None),
            player(2001, true, Some(1)),
            player(1005, false, Some(3)),
        ]}]}});
        let out = reduce(&data, &ids(&["1001", "1002", "1003", "1004", "1005"]), NOW);
        assert_eq!(out["source"], "STRATZ");
        assert_eq!(
            out["players"][0],
            json!({"accountId":"1001","matches":[{"match_id":77,"start_time":NOW - 3600,"mates":[
                {"id":"1002","party":true},
                {"id":"1003","party":false},
                {"id":"1004","party":null},
            ]}]})
        );
        // The unrequested teammate 2001 and the opponent 1005 never appear.
        assert!(!out.to_string().contains("2001"));
        assert_eq!(out["players"][4], json!({"accountId":"1005","matches":[]}));
    }

    #[test]
    fn reduce_skips_old_and_mateless_matches() {
        let data = json!({"p1001":{"matches":[
            {"id":1,"startDateTime":NOW - 91 * 24 * 3600,"players":[player(1001, true, Some(1)), player(1002, true, Some(1))]},
            {"id":2,"startDateTime":NOW - 60,"players":[player(1001, true, None), player(1002, false, None)]},
        ]},"p1002":null});
        let out = reduce(&data, &ids(&["1001", "1002"]), NOW);
        assert_eq!(out["players"][0]["matches"], json!([]));
        assert_eq!(out["players"][1]["matches"], json!([]));
    }

    #[test]
    fn request_rejects_one_eleven_or_duplicate_ids() {
        let mut one = Request {
            ids: ids(&["1001"]),
        };
        assert!(one.validate().is_err());
        let eleven: Vec<String> = (1001..1012).map(|id| id.to_string()).collect();
        assert!(Request { ids: eleven }.validate().is_err());
        assert!(Request {
            ids: ids(&["1001", "1001"])
        }
        .validate()
        .is_err());
        assert!(Request {
            ids: ids(&["1001", "x"])
        }
        .validate()
        .is_err());
        assert!(Request {
            ids: ids(&["1001", "1002"])
        }
        .validate()
        .is_ok());
    }
}
