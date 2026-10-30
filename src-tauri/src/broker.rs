//! A bounded public-data API for an Ancient Lens deployment. The upstream token
//! is server-only; clients cannot submit GraphQL, URLs or authorization headers.
use crate::{
    api::{client, read_response},
    stats::{self, Filter},
    store::{account_id, Result},
};
use axum::{
    extract::{ConnectInfo, DefaultBodyLimit, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    net::{IpAddr, SocketAddr},
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, Semaphore};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub ids: Vec<String>,
    pub days: u32,
    #[serde(default)]
    pub filter: Filter,
}
impl Request {
    pub fn validate(&mut self) -> Result<()> {
        stats::days(self.days)?;
        self.filter.validate()?;
        if self.ids.is_empty() || self.ids.len() > 5 {
            return Err("One to five accounts required".into());
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
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MatchRequest {
    pub id: String,
}
pub struct Broker {
    token: String,
    endpoint: String,
    client: reqwest::Client,
    cache: Mutex<HashMap<String, (Instant, Value)>>,
    limits: Mutex<HashMap<IpAddr, (Instant, u32)>>,
    budget: Mutex<(Instant, u32)>,
    hourly_budget: u32,
    upstream: Semaphore,
    draft_cache: Mutex<HashMap<String, (Instant, String, Value)>>,
    averages_cache: Mutex<HashMap<String, (Instant, String, Value)>>,
    totals_cache: Mutex<HashMap<String, (Instant, Value)>>,
}
impl Broker {
    pub async fn history(&self, mut request: crate::history::Request) -> Result<Value> {
        request.validate()?;
        let _permit = self.upstream.acquire().await.map_err(|_| "busy")?;
        let key = format!("history-{}-{}", request.id, request.offset);
        if let Some((at, value)) = self.cache.lock().await.get(&key) {
            if at.elapsed() < Duration::from_secs(120) {
                return Ok(value.clone());
            }
        }
        let payload = self
            .graphql_partial(crate::history::query(&request), true)
            .await?;
        let mut page = crate::history::page(&payload["data"]["player"], &request)?;
        if payload["errors"].as_array().is_some_and(|e| !e.is_empty()) && page["warning"].is_null()
        {
            page["warning"] = json!("STRATZ returned incomplete profile data.");
        }
        let mut cache = self.cache.lock().await;
        cache.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(120));
        if cache.len() > 5000 {
            cache.clear();
        }
        cache.insert(key, (Instant::now(), page.clone()));
        Ok(page)
    }
    /// One match by ID for the match journal. Short cache: IMP appears only after STRATZ
    /// processes the match, so a later request must be able to see it.
    pub async fn match_details(&self, request: MatchRequest) -> Result<Value> {
        let id = crate::match_details::match_id(&request.id)?;
        let _permit = self.upstream.acquire().await.map_err(|_| "busy")?;
        let key = format!("match-{id}");
        if let Some((at, value)) = self.cache.lock().await.get(&key) {
            if at.elapsed() < Duration::from_secs(120) {
                return Ok(value.clone());
            }
        }
        let payload = self
            .graphql_partial(crate::match_details::stratz_query(id), true)
            .await?;
        // An unknown or not yet indexed match is an upstream gap, not a bad request.
        let value =
            crate::match_details::from_stratz(id, &payload["data"]["match"]).map_err(|error| {
                // Shape and upstream messages only; player rows carry account IDs.
                let errors: Vec<_> = payload["errors"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|e| e["message"].as_str())
                    .collect();
                let players = payload["data"]["match"]["players"]
                    .as_array()
                    .map_or(0, Vec::len);
                eprintln!("STRATZ match: {error}; {players} players; errors {errors:?}");
                "upstream match unavailable"
            })?;
        let mut cache = self.cache.lock().await;
        cache.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(120));
        if cache.len() > 5000 {
            cache.clear();
        }
        cache.insert(key, (Instant::now(), value.clone()));
        Ok(value)
    }
    /// Recent teammates and STRATZ parties of a roster, one upstream request per roster.
    pub async fn parties(&self, mut request: crate::parties::Request) -> Result<Value> {
        request.validate()?;
        let mut sorted = request.ids.clone();
        sorted.sort();
        let key = format!("parties-{}", sorted.join(","));
        if let Some((at, value)) = self.cache.lock().await.get(&key) {
            if at.elapsed() < Duration::from_secs(600) {
                return Ok(value.clone());
            }
        }
        let _permit = self.upstream.acquire().await.map_err(|_| "busy")?;
        let payload = self
            .graphql_partial(crate::parties::query(&request.ids), true)
            .await?;
        if !payload["data"].is_object() {
            return Err("upstream parties unavailable".into());
        }
        let value = crate::parties::reduce(
            &payload["data"],
            &request.ids,
            chrono::Utc::now().timestamp(),
        );
        let mut cache = self.cache.lock().await;
        cache.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(600));
        if cache.len() > 5000 {
            cache.clear();
        }
        cache.insert(key, (Instant::now(), value.clone()));
        Ok(value)
    }
    pub fn new(token: String, hourly_budget: u32) -> Result<Arc<Self>> {
        if token.trim().is_empty() || token.contains(['\r', '\n']) || token.len() > 4096 {
            return Err("Set a valid server STRATZ_API_TOKEN".into());
        }
        Ok(Arc::new(Self {
            token,
            endpoint: "https://api.stratz.com/graphql".into(),
            client: client(),
            cache: Mutex::new(HashMap::new()),
            limits: Mutex::new(HashMap::new()),
            budget: Mutex::new((Instant::now(), 0)),
            hourly_budget,
            upstream: Semaphore::new(2),
            draft_cache: Mutex::new(HashMap::new()),
            averages_cache: Mutex::new(HashMap::new()),
            totals_cache: Mutex::new(HashMap::new()),
        }))
    }
    async fn permit(&self, ip: IpAddr) -> bool {
        let mut limits = self.limits.lock().await;
        limits.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(60));
        if limits.len() >= 10000 && !limits.contains_key(&ip) {
            return false;
        }
        let row = limits.entry(ip).or_insert((Instant::now(), 0));
        row.1 += 1;
        row.1 <= 30
    }
    async fn graphql(&self, query: String) -> Result<Value> {
        self.graphql_partial(query, false).await
    }
    async fn graphql_partial(&self, query: String, allow_partial: bool) -> Result<Value> {
        let started = Instant::now();
        let result = self.graphql_once(query, allow_partial).await;
        crate::api::net_log("upstream STRATZ graphql", started, &result);
        result
    }
    async fn graphql_once(&self, query: String, allow_partial: bool) -> Result<Value> {
        {
            let mut budget = self.budget.lock().await;
            if budget.0.elapsed() >= Duration::from_secs(3600) {
                *budget = (Instant::now(), 0);
            }
            if budget.1 >= self.hourly_budget {
                return Err("quota".into());
            }
            budget.1 += 1;
        }
        let response = self
            .client
            .post(&self.endpoint)
            .timeout(Duration::from_secs(45))
            .header("User-Agent", "STRATZ_API")
            .bearer_auth(&self.token)
            .json(&json!({"query":query}))
            .send()
            .await
            .map_err(|_| "upstream unavailable")?;
        if response.status().as_u16() == 429 {
            return Err("quota".into());
        }
        let value = read_response(response)
            .await
            .map_err(|_| "upstream unavailable")?;
        if !allow_partial && value["errors"].as_array().is_some_and(|e| !e.is_empty()) {
            return Err("upstream schema/access error".into());
        }
        Ok(value)
    }
    pub async fn totals(&self, mut request: Request) -> Result<Value> {
        request.validate()?;
        let mut cache = self.totals_cache.lock().await;
        cache.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(86400));
        let missing: Vec<_> = request
            .ids
            .iter()
            .filter(|id| !cache.contains_key(*id))
            .cloned()
            .collect();
        drop(cache);
        if !missing.is_empty() {
            let payload = self
                .graphql(format!(
                    "{{ players(steamAccountIds:[{}]) {{ steamAccountId matchCount winCount }} }}",
                    missing.join(",")
                ))
                .await?;
            let mut cache = self.totals_cache.lock().await;
            for row in payload["data"]["players"]
                .as_array()
                .ok_or("upstream format")?
            {
                if let (Some(id), Some(games), Some(wins)) = (
                    row["steamAccountId"].as_u64(),
                    row["matchCount"].as_u64(),
                    row["winCount"].as_u64(),
                ) {
                    if wins <= games && missing.contains(&id.to_string()) {
                        cache.insert(
                            id.to_string(),
                            (Instant::now(), json!({"games":games,"wins":wins})),
                        );
                    }
                }
            }
        }
        let cache = self.totals_cache.lock().await;
        Ok(
            json!({"summaries":request.ids.iter().map(|id| json!({"accountId":id,"days":request.days,"filter":request.filter,"source":"STRATZ","fetchedAt":crate::store::now(),"total":cache.get(id).map(|(_,v)|v)})).collect::<Vec<_>>()}),
        )
    }
    pub async fn draft(&self, request: crate::draft::Request) -> Result<Value> {
        crate::draft::validate_ids(&request.ids)?;
        // Each rank bracket has its own cached positions and matchups.
        let bracket = request.bracket()?;
        let key = |id: &str| format!("{bracket}:{id}");
        let (positions_missing, missing) = {
            let mut cache = self.draft_cache.lock().await;
            // Null entries remember missing heroes briefly without inventing matchup rows.
            cache.retain(|_, (at, _, value)| {
                at.elapsed() < Duration::from_secs(if value.is_null() { 120 } else { 3600 })
            });
            let missing: Vec<_> = request
                .ids
                .iter()
                .filter(|id| !cache.contains_key(&key(&id.to_string())))
                .copied()
                .collect();
            (!cache.contains_key(&key("positions")), missing)
        };
        // The lock is released during the upstream request: a draft request for cached
        // heroes must not wait behind another one that fetches a new hero.
        let fetched = if positions_missing || !missing.is_empty() {
            let payload = self
                .graphql(crate::draft::query(&missing, positions_missing, bracket))
                .await?;
            let data = &payload["data"]["heroStats"];
            crate::draft::validate_data(data, &missing, positions_missing)
                .map_err(|error| format!("upstream draft: {error}"))?;
            Some(payload)
        } else {
            None
        };
        let mut cache = self.draft_cache.lock().await;
        if let Some(payload) = &fetched {
            let data = &payload["data"]["heroStats"];
            let at = Instant::now();
            let fetched_at = crate::store::now();
            if positions_missing {
                cache.insert(
                    key("positions"),
                    (at, fetched_at.clone(), data["positions"].clone()),
                );
            }
            if !missing.is_empty() {
                for id in &missing {
                    cache.insert(key(&id.to_string()), (at, fetched_at.clone(), Value::Null));
                }
                for row in data["matchups"]
                    .as_array()
                    .ok_or("upstream matchups unavailable")?
                {
                    if let Some(id) = row["heroId"].as_u64().filter(|id| missing.contains(id)) {
                        cache.insert(key(&id.to_string()), (at, fetched_at.clone(), row.clone()));
                    }
                }
            }
        }
        // A response combines independently cached rows: report the oldest input.
        let oldest = std::iter::once(key("positions"))
            .chain(request.ids.iter().map(|id| key(&id.to_string())))
            .filter_map(|key| cache.get(&key))
            .min_by_key(|(at, _, _)| *at);
        Ok(
            json!({"source":"STRATZ","bracket":bracket,"fetchedAt":oldest.map(|(_,date,_)|date),"positions":cache.get(&key("positions")).map(|(_,_,v)|v),"matchups":request.ids.iter().filter_map(|id|cache.get(&key(&id.to_string())).map(|(_,_,v)|v).filter(|v|!v.is_null())).collect::<Vec<_>>()}),
        )
    }
    /// Hero averages by position and match duration for one rank bracket, cached per hero.
    /// A hero STRATZ returns nothing for is remembered briefly as empty.
    pub async fn averages(&self, request: crate::averages::Request) -> Result<Value> {
        request.validate()?;
        let bracket = request.bracket.as_str();
        let key = |id: &u64| format!("{bracket}:{id}");
        let missing: Vec<u64> = {
            let mut cache = self.averages_cache.lock().await;
            cache.retain(|_, (at, _, rows)| {
                let empty = rows.as_array().is_none_or(Vec::is_empty);
                at.elapsed() < Duration::from_secs(if empty { 120 } else { 6 * 3600 })
            });
            request
                .ids
                .iter()
                .filter(|id| !cache.contains_key(&key(id)))
                .copied()
                .collect()
        };
        // The lock is released during the upstream request, as for the draft.
        if !missing.is_empty() {
            let payload = self
                .graphql(crate::averages::query(&missing, bracket))
                .await?;
            let rows = crate::averages::parse(&payload["data"]["heroStats"], &missing)
                .map_err(|error| format!("upstream averages: {error}"))?;
            let (at, fetched_at) = (Instant::now(), crate::store::now());
            let mut cache = self.averages_cache.lock().await;
            for id in &missing {
                let own: Vec<_> = rows
                    .iter()
                    .filter(|row| row["heroId"] == *id)
                    .cloned()
                    .collect();
                cache.insert(key(id), (at, fetched_at.clone(), json!(own)));
            }
        }
        let cache = self.averages_cache.lock().await;
        let entries: Vec<_> = request
            .ids
            .iter()
            .filter_map(|id| cache.get(&key(id)))
            .collect();
        let oldest = entries
            .iter()
            .min_by_key(|(at, _, _)| *at)
            .map(|(_, date, _)| date);
        let rows: Vec<Value> = entries
            .iter()
            .flat_map(|(_, _, rows)| rows.as_array().cloned().unwrap_or_default())
            .collect();
        Ok(json!({"source":"STRATZ","bracket":bracket,"fetchedAt":oldest,"rows":rows}))
    }
    pub async fn summaries(&self, mut request: Request) -> Result<Value> {
        request.validate()?;
        let _permit = self.upstream.try_acquire().map_err(|_| "busy")?;
        let mut missing = vec![];
        let mut rows = HashMap::new();
        {
            let mut cache = self.cache.lock().await;
            cache.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(120));
            for id in &request.ids {
                if let Some((_, row)) = cache.get(id) {
                    rows.insert(id.clone(), row.clone());
                } else {
                    missing.push(id.clone());
                }
            }
        }
        if !missing.is_empty() {
            {
                let mut budget = self.budget.lock().await;
                if budget.0.elapsed() >= Duration::from_secs(3600) {
                    *budget = (Instant::now(), 0);
                }
                if budget.1 >= self.hourly_budget {
                    return Err("quota".into());
                }
                budget.1 += 1;
            }
            let started = Instant::now();
            let response = self
                .client
                .post(&self.endpoint)
                .header("User-Agent", "STRATZ_API")
                .bearer_auth(&self.token)
                .json(&json!({"query":stats::query(&missing)}))
                .send()
                .await;
            let response = match response {
                Ok(response) if response.status().as_u16() != 429 => response,
                other => {
                    let error = if other.is_ok() {
                        "quota"
                    } else {
                        "upstream unavailable"
                    };
                    crate::api::net_log("upstream STRATZ players", started, &Err(error.into()));
                    return Err(error.into());
                }
            };
            let payload = read_response(response).await;
            crate::api::net_log(
                &format!("upstream STRATZ players={}", missing.len()),
                started,
                &payload,
            );
            let payload = payload.map_err(|_| "upstream unavailable")?;
            if payload["errors"].as_array().is_some_and(|e| !e.is_empty()) {
                return Err("upstream schema/access error".into());
            }
            let players = payload["data"]["players"]
                .as_array()
                .ok_or("upstream format")?;
            let mut cache = self.cache.lock().await;
            if cache.len() > 5000 {
                cache.clear();
            }
            for row in players {
                if let Some(id) = row["steamAccountId"]
                    .as_u64()
                    .map(|n| n.to_string())
                    .filter(|id| missing.contains(id))
                {
                    cache.insert(id.clone(), (Instant::now(), row.clone()));
                    rows.insert(id, row.clone());
                }
            }
        }
        let summaries: Vec<_> = request
            .ids
            .iter()
            .filter_map(|id| {
                stats::from_stratz(
                    rows.get(id)?,
                    id,
                    request.days,
                    &request.filter,
                    chrono::Utc::now().timestamp(),
                )
                .ok()
            })
            .collect();
        // A missing/malformed profile must not discard the other four players.
        // The desktop batch worker reports missing IDs individually.
        Ok(json!({"summaries":summaries}))
    }
}
async fn summaries(
    State(broker): State<Arc<Broker>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(request): Json<Request>,
) -> std::result::Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !broker.permit(addr.ip()).await {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({"error":"rate limited"})),
        ));
    }
    broker.summaries(request).await.map(Json).map_err(|e|{
        let status=if e=="quota"||e=="busy"{StatusCode::TOO_MANY_REQUESTS}else if e.starts_with("upstream")||e=="profile unavailable"{StatusCode::BAD_GATEWAY}else{StatusCode::BAD_REQUEST};
        (status,Json(json!({"error":if status==StatusCode::BAD_REQUEST{"invalid request"}else{"statistics temporarily unavailable"}})))
    })
}
fn service_error(error: String) -> (StatusCode, Json<Value>) {
    let status = if error == "quota" || error == "busy" {
        StatusCode::TOO_MANY_REQUESTS
    } else if error.starts_with("upstream") {
        StatusCode::BAD_GATEWAY
    } else {
        StatusCode::BAD_REQUEST
    };
    (
        status,
        Json(
            json!({"error":if status == StatusCode::BAD_REQUEST { "invalid request" } else { "statistics temporarily unavailable" }}),
        ),
    )
}
async fn totals(
    State(broker): State<Arc<Broker>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(request): Json<Request>,
) -> std::result::Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !broker.permit(addr.ip()).await {
        return Err(service_error("quota".into()));
    }
    broker
        .totals(request)
        .await
        .map(Json)
        .map_err(service_error)
}
async fn draft(
    State(broker): State<Arc<Broker>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(request): Json<crate::draft::Request>,
) -> std::result::Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !broker.permit(addr.ip()).await {
        return Err(service_error("quota".into()));
    }
    broker.draft(request).await.map(Json).map_err(service_error)
}
pub fn router(broker: Arc<Broker>) -> Router {
    Router::new()
        .route(
            "/health",
            get(|| async { Json(json!({"status":"ready","protocol":1})) }),
        )
        .route("/v1/summaries", post(summaries))
        .route("/v1/totals", post(totals))
        .route("/v1/draft", post(draft))
        .route("/v1/averages", post(averages))
        .route("/v1/history", post(history))
        .route("/v1/match", post(match_details))
        .route("/v1/parties", post(parties))
        .layer(DefaultBodyLimit::max(4096))
        .layer(tower_http::timeout::TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(60),
        ))
        .layer(axum::middleware::from_fn(log_request))
        .with_state(broker)
}
/// Route, status and latency only; request bodies carry account IDs and stay unlogged.
async fn log_request(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let path = request.uri().path().to_string();
    let started = Instant::now();
    let response = next.run(request).await;
    if path != "/health" {
        eprintln!(
            "{} service {path} {} {}ms",
            chrono::Local::now().format("%H:%M:%S%.3f"),
            response.status().as_u16(),
            started.elapsed().as_millis()
        );
    }
    response
}
async fn history(
    State(broker): State<Arc<Broker>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(request): Json<crate::history::Request>,
) -> std::result::Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !broker.permit(addr.ip()).await {
        return Err(service_error("quota".into()));
    }
    broker
        .history(request)
        .await
        .map(Json)
        .map_err(service_error)
}
async fn averages(
    State(broker): State<Arc<Broker>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(request): Json<crate::averages::Request>,
) -> std::result::Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !broker.permit(addr.ip()).await {
        return Err(service_error("quota".into()));
    }
    broker
        .averages(request)
        .await
        .map(Json)
        .map_err(service_error)
}
async fn match_details(
    State(broker): State<Arc<Broker>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(request): Json<MatchRequest>,
) -> std::result::Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !broker.permit(addr.ip()).await {
        return Err(service_error("quota".into()));
    }
    broker
        .match_details(request)
        .await
        .map(Json)
        .map_err(service_error)
}
async fn parties(
    State(broker): State<Arc<Broker>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(request): Json<crate::parties::Request>,
) -> std::result::Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !broker.permit(addr.ip()).await {
        return Err(service_error("quota".into()));
    }
    broker
        .parties(request)
        .await
        .map(Json)
        .map_err(service_error)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn draft_rank_bracket_reaches_stratz_and_has_its_own_cache() {
        let queries = Arc::new(Mutex::new(Vec::<String>::new()));
        let seen = queries.clone();
        let upstream = Router::new().route("/", post(move |Json(body): Json<Value>| {
            let seen = seen.clone();
            async move {
                seen.lock().await.push(body["query"].as_str().unwrap().to_string());
                Json(json!({"data":{"heroStats":{"positions":[{"heroId":3,"position":"POSITION_5","week":1,"matchCount":1000,"winCount":500}],"matchups":[{"heroId":1,"vs":[],"with":[]}]}}}))
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
        let mut broker = Broker::new("test-secret".into(), 10).unwrap();
        Arc::get_mut(&mut broker).unwrap().endpoint = format!("http://{addr}/");
        let request = |bracket: Option<&str>| crate::draft::Request {
            ids: vec![1],
            bracket: bracket.map(String::from),
        };
        let top = broker
            .draft(request(Some("DIVINE_IMMORTAL")))
            .await
            .unwrap();
        assert_eq!(top["bracket"], "DIVINE_IMMORTAL");
        crate::draft::validate_response(&top, &[1], "DIVINE_IMMORTAL").unwrap();
        // All ranks is a separate request; the same bracket again comes from the cache.
        let all = broker.draft(request(None)).await.unwrap();
        assert_eq!(all["bracket"], "ALL");
        broker
            .draft(request(Some("DIVINE_IMMORTAL")))
            .await
            .unwrap();
        let queries = queries.lock().await;
        assert_eq!(queries.len(), 2);
        assert!(queries[0].contains("bracketBasicIds:[DIVINE_IMMORTAL]"));
        assert!(!queries[1].contains("bracketBasicIds"));
        assert!(broker.draft(request(Some("IMMORTAL"))).await.is_err());
        task.abort();
    }
    #[tokio::test]
    async fn averages_are_cached_per_bracket_and_hero() {
        let queries = Arc::new(Mutex::new(Vec::<String>::new()));
        let seen = queries.clone();
        let upstream = Router::new().route("/", post(move |Json(body): Json<Value>| {
            let seen = seen.clone();
            async move {
                seen.lock().await.push(body["query"].as_str().unwrap().to_string());
                Json(json!({"data":{"heroStats":{"stats":[
                    {"heroId":33,"position":"POSITION_3","time":30,"matchCount":400,"kills":5,"deaths":6,"assists":12},
                    {"heroId":7,"position":"POSITION_3","time":30,"matchCount":400,"kills":5,"deaths":6,"assists":12}
                ]}}}))
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
        let mut broker = Broker::new("test-secret".into(), 10).unwrap();
        Arc::get_mut(&mut broker).unwrap().endpoint = format!("http://{addr}/");
        let request = |ids: Vec<u64>, bracket: &str| crate::averages::Request {
            ids,
            bracket: bracket.into(),
        };
        let first = broker
            .averages(request(vec![33, 62], "DIVINE_IMMORTAL"))
            .await
            .unwrap();
        assert_eq!(first["source"], "STRATZ");
        assert_eq!(first["bracket"], "DIVINE_IMMORTAL");
        assert!(first["fetchedAt"].is_string());
        // Only requested heroes; a hero STRATZ did not return has no rows.
        assert_eq!(first["rows"].as_array().unwrap().len(), 1);
        assert_eq!(first["rows"][0]["heroId"], 33);
        // Both heroes are cached, including the empty one; another bracket asks again.
        broker
            .averages(request(vec![62, 33], "DIVINE_IMMORTAL"))
            .await
            .unwrap();
        broker
            .averages(request(vec![33], "LEGEND_ANCIENT"))
            .await
            .unwrap();
        let queries = queries.lock().await;
        assert_eq!(queries.len(), 2);
        assert!(queries[0].contains("heroIds:[33,62],bracketBasicIds:[DIVINE_IMMORTAL]"));
        assert!(queries[1].contains("heroIds:[33],bracketBasicIds:[LEGEND_ANCIENT]"));
        assert!(broker.averages(request(vec![], "ALL")).await.is_err());
        task.abort();
    }
    #[tokio::test]
    async fn draft_is_cached_and_rejects_unbounded_input() {
        assert!(crate::draft::validate_ids(&[1, 1]).is_err());
        assert!(crate::draft::validate_ids(&[1001]).is_err());
        assert!(crate::draft::validate_ids(&(1..=11).collect::<Vec<_>>()).is_err());
        assert!(serde_json::from_value::<crate::draft::Request>(
            json!({"ids":[1],"query":"arbitrary"})
        )
        .is_err());
        let upstream = Router::new().route("/", post(|Json(body): Json<Value>| async move {
            let query = body["query"].as_str().unwrap();
            assert!(query.contains("heroIds:[1,2]"));
            Json(json!({"data":{"heroStats":{"positions":[{"heroId":3,"position":"POSITION_5","week":1,"matchCount":1000,"winCount":500}],"matchups":[{"heroId":1,"vs":[],"with":[]},{"heroId":2,"vs":[],"with":[]}]}}}))
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, upstream).await.unwrap();
        });
        let mut broker = Broker::new("test-secret".into(), 1).unwrap();
        Arc::get_mut(&mut broker).unwrap().endpoint = format!("http://{addr}/");
        let result = broker
            .draft(crate::draft::Request {
                ids: vec![1, 2],
                bracket: None,
            })
            .await
            .unwrap();
        assert_eq!(result["positions"].as_array().unwrap().len(), 1);
        assert_eq!(result["matchups"].as_array().unwrap().len(), 2);
        task.abort();
        let cached = broker
            .draft(crate::draft::Request {
                ids: vec![2, 1],
                bracket: None,
            })
            .await
            .unwrap();
        assert_eq!(cached["matchups"][0]["heroId"], 2);
        assert_eq!(cached["fetchedAt"], result["fetchedAt"]);
        assert!(!cached.to_string().contains("test-secret"));
    }
    #[tokio::test]
    async fn draft_missing_hero_is_cached_briefly_and_retried_without_refetching_known_rows() {
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = calls.clone();
        let upstream = Router::new().route("/", post(move |Json(body): Json<Value>| {
            let attempt = count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            async move {
                let query = body["query"].as_str().unwrap();
                if attempt == 0 {
                    assert!(query.contains("heroIds:[1,2]"));
                    assert!(query.contains("positions:stats"));
                    Json(json!({"data":{"heroStats":{"positions":[{"heroId":3,"position":"POSITION_5","matchCount":1000,"winCount":500}],
                        "matchups":[{"heroId":1,"vs":[],"with":[]}]}}}))
                } else {
                    assert!(query.contains("heroIds:[2]"));
                    assert!(!query.contains("positions:stats"));
                    Json(json!({"data":{"heroStats":{"matchups":[{"heroId":2,"vs":[],"with":[]}]}}}))
                }
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, upstream).await.unwrap();
        });
        let mut broker = Broker::new("fixture-only".into(), 2).unwrap();
        Arc::get_mut(&mut broker).unwrap().endpoint = format!("http://{addr}/");
        let first = broker
            .draft(crate::draft::Request {
                ids: vec![1, 2],
                bracket: None,
            })
            .await
            .unwrap();
        crate::draft::validate_response(&first, &[1, 2], "ALL").unwrap();
        assert_eq!(first["matchups"], json!([{"heroId":1,"vs":[],"with":[]}]));
        {
            let cache = broker.draft_cache.lock().await;
            assert_eq!(cache["ALL:1"].2, first["matchups"][0]);
            assert_eq!(cache["ALL:positions"].2, first["positions"]);
            assert!(cache["ALL:2"].2.is_null());
        }
        for ids in [vec![2, 1], vec![1, 2], vec![2]] {
            let cached = broker
                .draft(crate::draft::Request {
                    ids: ids.clone(),
                    bracket: None,
                })
                .await
                .unwrap();
            crate::draft::validate_response(&cached, &ids, "ALL").unwrap();
            assert_eq!(cached["positions"], first["positions"]);
            assert_eq!(
                cached["matchups"].as_array().unwrap().len(),
                usize::from(ids.contains(&1))
            );
        }
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        {
            let mut cache = broker.draft_cache.lock().await;
            for (at, _, _) in cache.values_mut() {
                *at -= Duration::from_secs(121);
            }
        }
        let recovered = broker
            .draft(crate::draft::Request {
                ids: vec![1, 2],
                bracket: None,
            })
            .await
            .unwrap();
        crate::draft::validate_response(&recovered, &[1, 2], "ALL").unwrap();
        assert_eq!(recovered["matchups"].as_array().unwrap().len(), 2);
        assert_eq!(recovered["matchups"][0], first["matchups"][0]);
        assert_eq!(recovered["fetchedAt"], first["fetchedAt"]);
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 2);
        task.abort();
    }
    #[tokio::test]
    async fn draft_cached_heroes_do_not_wait_for_another_heroes_upstream_request() {
        let upstream = Router::new().route("/", post(|Json(body): Json<Value>| async move {
            let query = body["query"].as_str().unwrap().to_string();
            if query.contains("heroIds:[2]") {
                tokio::time::sleep(Duration::from_millis(1500)).await;
            }
            let id = if query.contains("heroIds:[2]") { 2 } else { 1 };
            Json(json!({"data":{"heroStats":{"positions":[{"heroId":3,"position":"POSITION_5","matchCount":1000,"winCount":500}],
                "matchups":[{"heroId":id,"vs":[],"with":[]}]}}}))
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, upstream).await.unwrap();
        });
        let mut broker = Broker::new("fixture-only".into(), 5).unwrap();
        Arc::get_mut(&mut broker).unwrap().endpoint = format!("http://{addr}/");
        broker
            .draft(crate::draft::Request {
                ids: vec![1],
                bracket: None,
            })
            .await
            .unwrap();
        let slow = {
            let broker = broker.clone();
            tokio::spawn(async move {
                broker
                    .draft(crate::draft::Request {
                        ids: vec![2],
                        bracket: None,
                    })
                    .await
            })
        };
        tokio::time::sleep(Duration::from_millis(100)).await;
        let cached = tokio::time::timeout(
            Duration::from_millis(500),
            broker.draft(crate::draft::Request {
                ids: vec![1],
                bracket: None,
            }),
        )
        .await
        .expect("a cached hero waited for the upstream request")
        .unwrap();
        assert_eq!(cached["matchups"][0]["heroId"], 1);
        assert_eq!(slow.await.unwrap().unwrap()["matchups"][0]["heroId"], 2);
        task.abort();
    }
    #[tokio::test]
    async fn draft_invalid_response_never_poison_cache_and_can_retry() {
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = calls.clone();
        let upstream = Router::new().route("/", post(move |Json(body): Json<Value>| {
            let attempt = count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            async move {
                // Failed attempts must not have cached positions or either hero.
                assert!(body["query"].as_str().unwrap().contains("positions:stats"));
                assert!(body["query"].as_str().unwrap().contains("heroIds:[1,2]"));
                let rows = match attempt {
                    0 => json!([{"heroId":1,"vs":null,"with":[]},{"heroId":2,"vs":[],"with":[]}]),
                    1 => json!([{"heroId":1,"vs":[],"with":[]},{"heroId":1,"vs":[],"with":[]}]),
                    2 => json!([{"heroId":1,"vs":[],"with":[]},{"heroId":99,"vs":[],"with":[]}]),
                    _ => json!([{"heroId":2,"vs":[],"with":[]},{"heroId":1,"vs":[],"with":[]}]),
                };
                Json(json!({"data":{"heroStats":{"positions":[{"heroId":3,"position":"POSITION_5","matchCount":1000,"winCount":500}],"matchups":rows}}}))
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, upstream).await.unwrap();
        });
        let mut broker = Broker::new("fixture-only".into(), 4).unwrap();
        Arc::get_mut(&mut broker).unwrap().endpoint = format!("http://{addr}/");
        for _ in 0..3 {
            assert!(broker
                .draft(crate::draft::Request {
                    ids: vec![1, 2],
                    bracket: None
                })
                .await
                .is_err());
            assert!(broker.draft_cache.lock().await.is_empty());
        }
        let recovered = broker
            .draft(crate::draft::Request {
                ids: vec![1, 2],
                bracket: None,
            })
            .await
            .unwrap();
        crate::draft::validate_response(&recovered, &[1, 2], "ALL").unwrap();
        let cached = broker
            .draft(crate::draft::Request {
                ids: vec![1, 2],
                bracket: None,
            })
            .await
            .unwrap();
        assert_eq!(cached, recovered);
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 4);
        task.abort();
    }
    #[test]
    fn rejects_arbitrary_queries_and_invalid_batches() {
        assert!(
            serde_json::from_value::<Request>(json!({"ids":["1"],"days":14,"query":"secret"}))
                .is_err()
        );
        for ids in [vec![], vec!["1"; 6], vec!["1", "1"], vec!["1) { token }"]] {
            assert!(Request {
                ids: ids.into_iter().map(String::from).collect(),
                days: 14,
                filter: Filter::default()
            }
            .validate()
            .is_err());
        }
    }
    #[tokio::test]
    async fn match_details_are_normalized_cached_and_validated() {
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let seen = calls.clone();
        let upstream = Router::new().route("/", post(move |Json(body): Json<Value>| {
            seen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            async move {
                if !body["query"].as_str().unwrap().contains("match(id:42)") {
                    return Json(json!({"data":{"match":null}}));
                }
                let players: Vec<Value> = (0..10u64)
                    .map(|i| json!({"steamAccountId":i + 1,"heroId":i + 1,"isRadiant":i < 5,"kills":1,"deaths":1,"imp":3}))
                    .collect();
                Json(json!({"data":{"match":{"id":42,"gameMode":"ALL_PICK_RANKED","lobbyType":"RANKED","players":players}}}))
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, upstream).await.unwrap();
        });
        let mut broker = Broker::new("test-secret".into(), 10).unwrap();
        Arc::get_mut(&mut broker).unwrap().endpoint = format!("http://{addr}/");
        let request = |id: &str| MatchRequest { id: id.into() };
        let m = broker.match_details(request("42")).await.unwrap();
        assert_eq!(
            (&m["source"], &m["game_mode"]),
            (&json!("STRATZ"), &json!(22))
        );
        assert_eq!(m["players"][3]["imp"], 3);
        broker.match_details(request("42")).await.unwrap();
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        for id in ["0", "x", "1234567890123"] {
            assert!(broker.match_details(request(id)).await.is_err());
        }
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        // A match the upstream does not return is unavailable, not a client error.
        let error = broker.match_details(request("43")).await.unwrap_err();
        assert!(error.starts_with("upstream"), "{error}");
        task.abort();
    }
    #[tokio::test]
    async fn parties_are_cached_per_id_set() {
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let seen = calls.clone();
        let upstream = Router::new().route("/", post(move |Json(body): Json<Value>| {
            seen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            async move {
                assert!(body["query"].as_str().unwrap().contains("p1001: player(steamAccountId:1001)"));
                let now = chrono::Utc::now().timestamp();
                let players = json!([
                    {"steamAccountId":1001,"isRadiant":true,"partyId":4},
                    {"steamAccountId":1002,"isRadiant":true,"partyId":4},
                    {"steamAccountId":3003,"isRadiant":true,"partyId":4},
                ]);
                Json(json!({"data":{"p1001":{"matches":[{"id":9,"startDateTime":now - 60,"players":players}]},"p1002":null}}))
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, upstream).await.unwrap();
        });
        let mut broker = Broker::new("test-secret".into(), 10).unwrap();
        Arc::get_mut(&mut broker).unwrap().endpoint = format!("http://{addr}/");
        let request = |ids: &[&str]| crate::parties::Request {
            ids: ids.iter().map(|id| id.to_string()).collect(),
        };
        let value = broker.parties(request(&["1001", "1002"])).await.unwrap();
        assert_eq!(
            value["players"][0]["matches"][0]["mates"],
            json!([{"id":"1002","party":true}])
        );
        assert!(!value.to_string().contains("3003"));
        broker.parties(request(&["1002", "1001"])).await.unwrap();
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert!(broker.parties(request(&["1001"])).await.is_err());
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        task.abort();
    }
    #[tokio::test]
    async fn server_keeps_token_and_maps_reordered_profiles() {
        let upstream=Router::new().route("/",post(|headers:axum::http::HeaderMap,Json(body):Json<Value>|async move{
            assert_eq!(headers["authorization"],"Bearer test-secret");assert!(body["query"].as_str().unwrap().contains("steamAccountIds:[1,2]"));
            Json(json!({"data":{"players":[{"steamAccountId":2,"matchCount":200,"winCount":100,"matches":[]},{"steamAccountId":1,"matchCount":50,"winCount":20,"matches":[]}]}}))
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, upstream).await.unwrap();
        });
        let mut broker = Broker::new("test-secret".into(), 1).unwrap();
        Arc::get_mut(&mut broker).unwrap().endpoint = format!("http://{addr}/");
        let make = || Request {
            ids: vec!["1".into(), "2".into()],
            days: 14,
            filter: Filter::default(),
        };
        let result = broker.summaries(make()).await.unwrap();
        assert_eq!(result["summaries"][0]["total"]["games"], 50);
        assert_eq!(result["summaries"][1]["total"]["games"], 200);
        assert!(!result.to_string().contains("test-secret"));
        task.abort();
        assert!(broker.summaries(make()).await.is_ok()); // cached rows do not consume a second upstream query
    }
}
