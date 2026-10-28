//! Average statistics of a hero by position and rank bracket (STRATZ `heroStats.stats`),
//! the baseline the profile compares a match against. Each row is a minute of the game
//! (0 to 35) with cumulative values over the games still running then.
use crate::store::Result;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub ids: Vec<u64>,
    /// One of `draft::BRACKETS`.
    pub bracket: String,
}
impl Request {
    pub fn validate(&self) -> Result<()> {
        if self.ids.is_empty() {
            return Err("Invalid hero IDs".into());
        }
        crate::draft::validate_ids(&self.ids)?;
        crate::draft::valid_bracket(&self.bracket)?;
        Ok(())
    }
}
/// Averages by position and game minute for the given heroes.
pub fn query(ids: &[u64], bracket: &str) -> String {
    let filter = if bracket == "ALL" {
        String::new()
    } else {
        format!(",bracketBasicIds:[{bracket}]")
    };
    let ids = ids.iter().map(u64::to_string).collect::<Vec<_>>().join(",");
    format!("{{ heroStats {{ stats(heroIds:[{ids}]{filter},groupByPosition:true,groupByTime:true,groupByBracket:false) {{ heroId position time matchCount kills deaths assists goldPerMinute xp cs heroDamage networth teamKills }} }} }}")
}
/// Rows of the requested heroes with a known position and at least one match. Missing
/// numbers stay null. Kill participation is (kills + assists) / team kills, in percent:
/// STRATZ `killContributionAverage` is only kills plus assists.
pub fn parse(data: &Value, ids: &[u64]) -> Result<Vec<Value>> {
    let rows = data["stats"]
        .as_array()
        .ok_or("upstream hero averages unavailable")?;
    let number = |row: &Value, field: &str| row[field].as_f64().filter(|v| v.is_finite());
    Ok(rows
        .iter()
        .filter_map(|row| {
            let hero = row["heroId"].as_u64().filter(|id| ids.contains(id))?;
            let position = row["position"]
                .as_str()?
                .strip_prefix("POSITION_")?
                .parse::<u8>()
                .ok()
                .filter(|p| (1..=5).contains(p))?;
            let count = row["matchCount"].as_u64().filter(|c| *c > 0)?;
            let contribution = number(row, "teamKills")
                .filter(|team| *team > 0.0)
                .zip(number(row, "kills").zip(number(row, "assists")))
                .map(|(team, (kills, assists))| ((kills + assists) / team * 1000.0).round() / 10.0);
            Some(json!({"heroId":hero,"position":position,"time":row["time"].as_u64(),"matchCount":count,
                "kills":number(row,"kills"),"deaths":number(row,"deaths"),"assists":number(row,"assists"),
                "goldPerMinute":number(row,"goldPerMinute"),"xp":number(row,"xp"),"cs":number(row,"cs"),
                "heroDamage":number(row,"heroDamage"),"networth":number(row,"networth"),"killContribution":contribution}))
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn query_asks_for_positions_time_and_averages() {
        let query = query(&[33, 62], "DIVINE_IMMORTAL");
        assert!(query.contains("stats(heroIds:[33,62],bracketBasicIds:[DIVINE_IMMORTAL],groupByPosition:true,groupByTime:true,groupByBracket:false)"));
        for field in [
            "heroId",
            "position",
            "time",
            "matchCount",
            "kills",
            "deaths",
            "assists",
            "goldPerMinute",
            "xp",
            "cs",
            "heroDamage",
            "networth",
            "teamKills",
        ] {
            assert!(query.contains(&format!(" {field} ")), "{field}");
        }
        let all = super::query(&[33], "ALL");
        assert!(!all.contains("bracketBasicIds"));
        assert!(all.contains("stats(heroIds:[33],groupByPosition:true"));
    }

    #[test]
    fn parse_keeps_requested_heroes_with_a_position() {
        let row = |hero: u64, position: Value, count: u64| {
            json!({"heroId":hero,"position":position,"time":30,"matchCount":count,"kills":5.5,"deaths":6.25,"assists":12,
                "goldPerMinute":410,"xp":19000,"cs":160,"heroDamage":21000,"networth":15000,"teamKills":28})
        };
        let data = json!({"stats":[
            row(33, json!("POSITION_3"), 400),
            row(99, json!("POSITION_3"), 400),
            row(33, Value::Null, 400),
            row(33, json!("POSITION_2"), 0),
            {"heroId":33,"position":"POSITION_5","matchCount":20,"kills":2,"deaths":7,"assists":15}
        ]});
        let rows = parse(&data, &[33]).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["heroId"], 33);
        assert_eq!(rows[0]["position"], 3);
        assert_eq!(rows[0]["time"], 30);
        assert_eq!(rows[0]["deaths"], 6.25);
        // Kill participation: (5.5 + 12) / 28 team kills.
        assert_eq!(rows[0]["killContribution"], 62.5);
        // Missing optional numbers stay unknown, never zero.
        assert_eq!(rows[1]["position"], 5);
        assert!(rows[1]["time"].is_null());
        assert!(rows[1]["goldPerMinute"].is_null());
        assert!(rows[1]["killContribution"].is_null());
        assert!(parse(&json!({}), &[33]).is_err());
    }

    #[test]
    fn parse_reads_the_live_fixture() {
        // Live response of October 27, 2026 (Juggernaut, Divine–Immortal), trimmed to five
        // minutes: a cumulative timeline per position, goldPerMinute always null.
        let data: Value =
            serde_json::from_str(include_str!("fixtures/stratz-hero-averages.json")).unwrap();
        let rows = parse(&data["heroStats"], &[8]).unwrap();
        assert_eq!(rows.len(), 25);
        assert!(rows
            .iter()
            .all(|row| (1..=5).contains(&row["position"].as_u64().unwrap())));
        let carry = |time: u64| {
            rows.iter()
                .find(|row| row["position"] == 1 && row["time"] == time)
                .unwrap()
        };
        assert!(carry(35)["goldPerMinute"].is_null());
        assert!(carry(0)["killContribution"].is_null());
        let kp = carry(35)["killContribution"].as_f64().unwrap();
        assert!((30.0..=70.0).contains(&kp), "{kp}");
        assert!(carry(35)["cs"].as_f64().unwrap() > carry(20)["cs"].as_f64().unwrap());
    }

    #[test]
    fn request_rejects_bad_input() {
        let request = |ids: Vec<u64>, bracket: &str| {
            Request {
                ids,
                bracket: bracket.into(),
            }
            .validate()
        };
        assert!(request(vec![33, 62], "DIVINE_IMMORTAL").is_ok());
        assert!(request((1..=11).collect(), "ALL").is_err());
        assert!(request(vec![33, 33], "ALL").is_err());
        assert!(request(vec![0], "ALL").is_err());
        assert!(request(vec![], "ALL").is_err());
        assert!(request(vec![33], "IMMORTAL").is_err());
    }
}
