//! Historical purchases by the own hero, split by the other heroes in the match.
//! Explorer's league sample is observational: these counts are not causal item effects.
use crate::store::Result;
use serde_json::{json, Value};
use std::collections::HashSet;

pub const VERSION: &str = "items-v4";
pub const TTL: i64 = 6 * 3_600_000;
/// Explorer keeps only parsed league matches, and in the last half year far fewer of them:
/// a year gives roughly ten times more matchup evidence per hero (at most 2,000 matches).
pub const SAMPLE_DAYS: u64 = 365;

pub fn query(hero: u64) -> Result<String> {
    if !(1..=1000).contains(&hero) {
        return Err("Invalid own hero".into());
    }
    // Only the validated integer is interpolated. No SQL or filters come from the page.
    let window = SAMPLE_DAYS * 86_400;
    Ok(format!(
        r#"WITH recent AS (
 SELECT m.match_id, a.player_slot, a.purchase, a.purchase_log,
 ARRAY[a.item_0,a.item_1,a.item_2,a.item_3,a.item_4,a.item_5] AS final_items,
 m.radiant_win=(a.player_slot<128) AS won, m.start_time
 FROM player_matches a JOIN matches m ON m.match_id=a.match_id
 WHERE a.hero_id={hero} AND a.purchase IS NOT NULL AND a.purchase_log IS NOT NULL
 AND m.radiant_win IS NOT NULL AND m.leagueid>0
 AND m.start_time>extract(epoch from now())-{window}
 AND (SELECT count(*) FROM player_matches p WHERE p.match_id=m.match_id)=10
 ORDER BY m.match_id DESC LIMIT 2000
), eligible AS (
 SELECT i.id AS "itemId", substring(i.name from 6) AS name,
 i.localized_name AS label, i.cost, count(*) AS popularity,
 count(*) FILTER(WHERE i.id=ANY(r.final_items)) AS inventory_popularity
 FROM recent r CROSS JOIN LATERAL json_each_text(r.purchase) j
 JOIN items i ON i.name='item_'||j.key
 WHERE i.cost>=1000 AND i.recipe=0 AND j.value::int>0
 AND i.id IN (1,48,50,63,65,67,69,79,81,90,96,98,100,102,104,106,108,110,112,114,116,119,121,123,125,127,129,133,135,137,139,141,143,145,147,149,151,152,154,156,158,160,162,164,166,168,170,172,174,176,180,185,190,193,194,196,206,208,210,220,223,225,226,229,231,232,235,236,242,247,249,250,252,254,256,259,263,267,269,271,273,277,369,534,569,596,598,600,603,604,609,610,635,692,908,911,931,939,1076,1097,1107,1128,1466,1806,1808,1852,1854,1856,1858)
 GROUP BY i.id,i.name,i.localized_name,i.cost
), candidates AS (
 SELECT * FROM eligible ORDER BY popularity DESC,"itemId" LIMIT 24
), paths AS (
 SELECT r.match_id,r.won,array_agg(e."itemId" ORDER BY t.time,e."itemId") AS ids,
 array_agg(e."itemId" ORDER BY e."itemId") AS canonical,
 sum(ln(1+e.inventory_popularity)) AS popularity
 FROM recent r JOIN eligible e ON e."itemId"=ANY(r.final_items)
 JOIN LATERAL (SELECT min((event->>'time')::int) AS time
 FROM unnest(r.purchase_log) event WHERE event->>'key'=e.name) t ON t.time IS NOT NULL
 GROUP BY r.match_id,r.won HAVING count(*)>=5
), repeated AS (
 SELECT canonical,count(*)::int AS games,count(*) FILTER(WHERE won)::int AS wins,
 max(match_id) AS latest,max(popularity) AS popularity
 FROM paths GROUP BY canonical HAVING count(*)>=2
), common AS (
 SELECT p.ids,g.games,g.wins,g.popularity,p.match_id
 FROM repeated g JOIN paths p ON p.match_id=g.latest
 ORDER BY g.games DESC,g.popularity DESC,p.match_id DESC LIMIT 3
), standards AS (
 SELECT * FROM common UNION ALL
 SELECT p.ids,1,p.won::int,p.popularity,p.match_id
 FROM (SELECT * FROM paths ORDER BY popularity DESC,cardinality(ids) DESC,match_id DESC LIMIT 1) p
 WHERE NOT EXISTS(SELECT 1 FROM common)
), observations AS (
 SELECT r.*,c."itemId",COALESCE((r.purchase->>c.name)::int,0)>0 AS bought
 FROM recent r CROSS JOIN candidates c
), totals AS (
 SELECT "itemId",count(*)::int AS games,count(*) FILTER(WHERE won)::int AS wins,
 count(*) FILTER(WHERE bought)::int AS "withGames",
 count(*) FILTER(WHERE bought AND won)::int AS "withWins"
 FROM observations GROUP BY "itemId"
), pairs AS (
 SELECT o."itemId",p.hero_id AS "otherHeroId",
 CASE WHEN (o.player_slot<128)=(p.player_slot<128) THEN 'ally' ELSE 'enemy' END AS relation,
 count(*)::int AS games,count(*) FILTER(WHERE o.won)::int AS wins,
 count(*) FILTER(WHERE o.bought)::int AS "withGames",
 count(*) FILTER(WHERE o.bought AND o.won)::int AS "withWins"
 FROM observations o JOIN player_matches p ON p.match_id=o.match_id
 WHERE p.player_slot<>o.player_slot AND p.hero_id<>{hero}
 GROUP BY o."itemId",p.hero_id,relation
)
SELECT json_build_object('heroId',{hero},'sampleMatches',(SELECT count(*)::int FROM recent),
 'oldest',(SELECT min(start_time) FROM recent),'newest',(SELECT max(start_time) FROM recent),
 'standardBuilds',COALESCE((SELECT json_agg(json_build_object('matches',s.games,'wins',s.wins,
 'items',(SELECT json_agg(json_build_object('itemId',e."itemId",'name',e.name,'label',e.label,'cost',e.cost) ORDER BY step.position)
 FROM unnest(s.ids) WITH ORDINALITY AS step(id,position) JOIN eligible e ON e."itemId"=step.id))
 ORDER BY s.games DESC,s.popularity DESC,s.match_id DESC) FROM standards s),'[]'::json),
 'items',COALESCE((SELECT json_agg(json_build_object('itemId',c."itemId",'name',c.name,
 'label',c.label,'cost',c.cost,'games',t.games,'wins',t.wins,
 'withGames',t."withGames",'withWins',t."withWins")) FROM candidates c JOIN totals t USING("itemId")),'[]'::json),
 'pairs',COALESCE((SELECT json_agg(p) FROM pairs p),'[]'::json)) AS data"#
    ))
}

fn counts(v: &Value) -> Option<(u64, u64, u64, u64)> {
    let g = v["games"].as_u64()?;
    let w = v["wins"].as_u64()?;
    let n = v["withGames"].as_u64()?;
    let k = v["withWins"].as_u64()?;
    (g <= 2000 && w <= g && n <= g && k <= n && k <= w && w - k <= g - n).then_some((g, w, n, k))
}

fn valid_item(item: &Value) -> bool {
    let Some(id) = item["itemId"].as_u64() else {
        return false;
    };
    let Some(name) = item["name"].as_str() else {
        return false;
    };
    (1..=10000).contains(&id)
        && !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        && item["label"]
            .as_str()
            .is_some_and(|s| !s.is_empty() && s.len() <= 150)
        && item["cost"]
            .as_u64()
            .is_some_and(|n| (1000..=100_000).contains(&n))
}

pub fn validate(data: &Value, hero: u64) -> Result<()> {
    let invalid = || "Invalid item statistics".to_string();
    let sample = data["sampleMatches"].as_u64().ok_or_else(invalid)?;
    if data["heroId"] != hero || sample > 2000 {
        return Err(invalid().into());
    }
    match (sample, data["oldest"].as_u64(), data["newest"].as_u64()) {
        (0, None, None) if data["oldest"].is_null() && data["newest"].is_null() => {}
        (1.., Some(a), Some(b)) if a > 0 && a <= b && b - a <= SAMPLE_DAYS * 86_400 => {}
        _ => return Err(invalid().into()),
    }
    let items = data["items"].as_array().ok_or_else(invalid)?;
    let pairs = data["pairs"].as_array().ok_or_else(invalid)?;
    if items.len() > 24 || pairs.len() > 48_000 || (sample == 0 && !items.is_empty()) {
        return Err(invalid().into());
    }
    let mut ids = HashSet::new();
    for item in items {
        if !valid_item(item)
            || !ids.insert(item["itemId"].as_u64().unwrap())
            || !counts(item).is_some_and(|(g, _, _, _)| g == sample)
        {
            return Err(invalid().into());
        }
    }
    let standards = data["standardBuilds"].as_array().ok_or_else(invalid)?;
    if standards.len() > 3 || (sample == 0 && !standards.is_empty()) {
        return Err(invalid().into());
    }
    let mut seen = HashSet::new();
    let mut sum = 0;
    let mut previous = sample;
    for (index, build) in standards.iter().enumerate() {
        let items = build["items"].as_array().ok_or_else(invalid)?;
        let games = build["matches"]
            .as_u64()
            .filter(|games| *games <= sample)
            .ok_or_else(invalid)?;
        let wins = build["wins"].as_u64().ok_or_else(invalid)?;
        let mut ids = Vec::new();
        for item in items {
            if !valid_item(item) {
                return Err(invalid().into());
            }
            ids.push(item["itemId"].as_u64().unwrap());
        }
        ids.sort_unstable();
        sum += games;
        if !(5..=6).contains(&items.len())
            || ids.windows(2).any(|p| p[0] == p[1])
            || !seen.insert(ids)
            || games == 0
            || games > previous
            || wins > games
            || (index > 0 && games < 2)
            || sum > sample
        {
            return Err(invalid().into());
        }
        previous = games;
    }
    let mut keys = HashSet::new();
    for row in pairs {
        let id = row["itemId"].as_u64().ok_or_else(invalid)?;
        let other = row["otherHeroId"].as_u64().ok_or_else(invalid)?;
        let relation = row["relation"].as_str().ok_or_else(invalid)?;
        let total = items
            .iter()
            .find(|i| i["itemId"] == id)
            .ok_or_else(invalid)?;
        let (g, w, n, k) = counts(row).ok_or_else(invalid)?;
        let (tg, tw, tn, tk) = counts(total).ok_or_else(invalid)?;
        if !(1..=1000).contains(&other) || other == hero
            || !["enemy", "ally"].contains(&relation) || !keys.insert((id, other, relation))
            || g > tg || w > tw || n > tn || k > tk
            // The complementary group must also contain possible win/loss counts.
            || !valid_complement(tg, tw, tn, tk, g, w, n, k)
        {
            return Err(invalid().into());
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn valid_complement(tg: u64, tw: u64, tn: u64, tk: u64, g: u64, w: u64, n: u64, k: u64) -> bool {
    counts(&json!({"games":tg-g,"wins":tw-w,"withGames":tn-n,"withWins":tk-k})).is_some()
}

pub fn parse(response: &Value, hero: u64) -> Result<Value> {
    if !response["err"].is_null() || response["rows"].as_array().map(Vec::len) != Some(1) {
        return Err("OpenDota item query failed".into());
    }
    let data = &response["rows"][0]["data"];
    validate(data, hero)?;
    Ok(data.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn data() -> Value {
        json!({"heroId":1,"sampleMatches":100,"oldest":100,"newest":200,"standardBuilds":[],
            "items":[{"itemId":225,"name":"nullifier","label":"Nullifier","cost":4350,
            "games":100,"wins":50,"withGames":40,"withWins":25}],
            "pairs":[{"itemId":225,"otherHeroId":36,"relation":"enemy",
            "games":40,"wins":20,"withGames":20,"withWins":15}]})
    }
    #[test]
    fn fixed_query_validates_the_only_interpolated_value() {
        assert!(query(0).is_err());
        assert!(query(1001).is_err());
        let sql = query(36).unwrap();
        assert!(sql.contains("a.hero_id=36"));
        assert!(sql.contains("purchase_log IS NOT NULL"));
        assert!(sql.contains("m.leagueid>0"));
        assert!(sql.contains("LIMIT 2000"));
        assert!(sql.contains("now())-31536000"));
    }
    #[test]
    fn validates_subsets_not_just_nonnegative_counts() {
        assert!(validate(&data(), 1).is_ok());
        for (path, value) in [
            ("/items/0/name", json!("../bad")),
            ("/items/0/withWins", json!(41)),
            ("/pairs/0/withWins", json!(24)),
            ("/pairs/0/games", json!(99)),
            ("/pairs/0/otherHeroId", json!(1)),
            ("/pairs/0/relation", json!("other")),
            ("/pairs/0/wins", json!(50)),
            ("/heroId", json!(2)),
            ("/sampleMatches", json!(99)),
        ] {
            let mut bad = data();
            *bad.pointer_mut(path).unwrap() = value;
            assert!(validate(&bad, 1).is_err(), "{path}");
        }
        let mut duplicate = data();
        duplicate["pairs"]
            .as_array_mut()
            .unwrap()
            .push(data()["pairs"][0].clone());
        assert!(validate(&duplicate, 1).is_err());
    }
    #[test]
    fn sample_may_span_one_year_but_not_more() {
        let mut year = data();
        year["newest"] = json!(100 + SAMPLE_DAYS * 86_400);
        assert!(validate(&year, 1).is_ok());
        year["newest"] = json!(101 + SAMPLE_DAYS * 86_400);
        assert!(validate(&year, 1).is_err());
    }
    #[test]
    fn standard_variants_require_distinct_supported_equipment_sets() {
        let items: Vec<Value> = (1..=6)
            .map(|id| json!({"itemId":id,"name":"fixture","label":"Fixture equipment","cost":1000}))
            .collect();
        let build = json!({"items":items,"matches":20,"wins":10});
        let mut good = data();
        good["standardBuilds"] = json!([build.clone()]);
        assert!(validate(&good, 1).is_ok());
        let mut bad = good.clone();
        bad["standardBuilds"] = json!([build.clone(), build.clone()]);
        assert!(validate(&bad, 1).is_err());
        bad = good.clone();
        bad["standardBuilds"][0]["matches"] = json!(u64::MAX);
        assert!(validate(&bad, 1).is_err());
        bad = good.clone();
        bad["standardBuilds"][0]["wins"] = json!(21);
        assert!(validate(&bad, 1).is_err());
        bad = good.clone();
        bad["standardBuilds"][0]["items"] = json!([]);
        assert!(validate(&bad, 1).is_err());
    }
    #[test]
    fn empty_and_failed_queries_are_distinct() {
        let empty = json!({"heroId":1,"sampleMatches":0,"oldest":null,"newest":null,"items":[],"pairs":[],"standardBuilds":[]});
        assert!(parse(&json!({"rows":[{"data":empty}]}), 1).is_ok());
        assert!(parse(&json!({"rows":[{"data":data()}],"err":"timeout"}), 1).is_err());
        assert!(parse(&json!({"rows":[]}), 1).is_err());
    }
}
