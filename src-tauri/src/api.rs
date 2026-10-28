use crate::{
    stats::{self, Filter},
    store::{account_id, atomic_json, now, Result},
};
use futures::future::join_all;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{mpsc, oneshot, Mutex, Semaphore};

/// One stderr line per outbound request: destination, size and outcome.
/// Account IDs, tokens and response bodies are never logged.
pub(crate) fn net_log(target: &str, started: Instant, outcome: &Result<Value>) {
    let outcome = match outcome {
        Ok(_) => "ok".to_string(),
        Err(error) => format!("error: {error}"),
    };
    eprintln!(
        "{} net {target} {}ms {outcome}",
        chrono::Local::now().format("%H:%M:%S%.3f"),
        started.elapsed().as_millis()
    );
}
/// `players/123/recentMatches` -> `players/#/recentMatches`.
fn endpoint_shape(endpoint: &str) -> String {
    endpoint
        .split('/')
        .map(|part| {
            if !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()) {
                "#"
            } else {
                part.split('?').next().unwrap_or("")
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}

pub async fn read_response(mut response: reqwest::Response) -> Result<Value> {
    if !response.status().is_success() {
        return Err(format!(
            "Statistics service unavailable (HTTP {}).",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|n| n > 4 * 1024 * 1024)
    {
        return Err("API response is too large".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read the API response")?
    {
        if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
            return Err("API response is too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "The API returned invalid JSON".into())
}
pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("AncientLens/0.4")
        .build()
        .expect("TLS client")
}
pub struct Api {
    directory: PathBuf,
    client: reqwest::Client,
    next: Mutex<Instant>,
    cooldown: Mutex<Instant>,
    issue: Mutex<String>,
    paused: tokio::sync::Notify,
    locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    slots: Semaphore,
    summary_slots: Semaphore,
    player_slots: Semaphore,
    broker: Option<mpsc::Sender<Pending>>,
    totals: Option<mpsc::Sender<Pending>>,
    broker_url: Option<String>,
}
struct Pending {
    id: String,
    days: u32,
    filter: Filter,
    result: oneshot::Sender<Result<Value>>,
}
impl Api {
    pub fn new(directory: PathBuf, broker_url: Option<String>) -> Result<Arc<Self>> {
        let client = client();
        let broker = if let Some(url) = broker_url.clone() {
            let parsed = reqwest::Url::parse(&url).map_err(|_| "Invalid statistics service URL")?;
            if parsed.scheme() != "https"
                && !(parsed.scheme() == "http"
                    && [Some("127.0.0.1"), Some("localhost")].contains(&parsed.host_str()))
            {
                return Err("The statistics service requires HTTPS".into());
            }
            let (tx, rx) = mpsc::channel(30);
            tokio::spawn(batch_worker(rx, client.clone(), url, "summaries"));
            Some(tx)
        } else {
            None
        };
        let totals = broker_url.as_ref().map(|url| {
            let (tx, rx) = mpsc::channel(30);
            tokio::spawn(batch_worker(rx, client.clone(), url.clone(), "totals"));
            tx
        });
        let prune = directory.clone();
        tokio::task::spawn_blocking(move || prune_cache(&prune, CACHE_MAX_AGE));
        Ok(Arc::new(Self {
            directory,
            client,
            next: Mutex::new(Instant::now()),
            cooldown: Mutex::new(Instant::now()),
            issue: Mutex::new(String::new()),
            paused: tokio::sync::Notify::new(),
            locks: Mutex::new(HashMap::new()),
            slots: Semaphore::new(40),
            summary_slots: Semaphore::new(20),
            player_slots: Semaphore::new(3),
            broker,
            totals,
            broker_url,
        }))
    }
    pub fn info(&self) -> Value {
        json!({"source":if self.broker.is_some(){"STRATZ"}else{"OpenDota"},"hasToken":false,"persistent":false,"automatic":true,"serviceConfigured":self.broker.is_some(),"status":if self.broker.is_some(){"Service configured; access is checked when loading a match."}else{"Using public OpenDota. For STRATZ features, set up a local service; see docs/guide/stats-service.md."}})
    }
    async fn lock(&self, key: &str) -> Arc<Mutex<()>> {
        let mut locks = self.locks.lock().await;
        locks.retain(|_, v| Arc::strong_count(v) > 1);
        locks.entry(key.into()).or_default().clone()
    }
    async fn request(&self, endpoint: &str) -> Result<Value> {
        let started = Instant::now();
        let result = self.request_once(endpoint).await;
        net_log(
            &format!("OpenDota {}", endpoint_shape(endpoint)),
            started,
            &result,
        );
        result
    }
    async fn request_once(&self, endpoint: &str) -> Result<Value> {
        for attempt in 0..2 {
            if Instant::now() < *self.cooldown.lock().await {
                return Err(self.issue.lock().await.clone());
            }
            let when = {
                let mut next = self.next.lock().await;
                let when = (*next).max(Instant::now());
                *next = when + Duration::from_millis(1100);
                when
            };
            tokio::select! { _ = tokio::time::sleep_until(when.into()) => {}, _ = self.paused.notified() => {} }
            if Instant::now() < *self.cooldown.lock().await {
                return Err(self.issue.lock().await.clone());
            }
            let response = match self
                .client
                .get(format!("https://api.opendota.com/api/{endpoint}"))
                .send()
                .await
            {
                Ok(r) => r,
                Err(_) if attempt == 0 => continue,
                Err(_) => {
                    let message = "OpenDota did not respond after a retry. New requests are paused for one minute.";
                    self.pause(60, message).await;
                    return Err(message.into());
                }
            };
            if response.status().as_u16() == 429 {
                let retry = response
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(60)
                    .clamp(60, 3600);
                self.pause(
                    retry,
                    "OpenDota rate limit reached. Try again in one minute.",
                )
                .await;
            }
            if response.status().is_server_error() && attempt == 0 {
                continue;
            }
            if response.status().is_server_error() {
                let message = format!(
                    "OpenDota unavailable (HTTP {}). New requests are paused for one minute.",
                    response.status().as_u16()
                );
                self.pause(60, &message).await;
                return Err(message);
            }
            return read_response(response)
                .await
                .map_err(|e| format!("OpenDota: {e}"));
        }
        unreachable!()
    }
    pub async fn resource(&self, endpoint: &str, ttl: i64) -> Result<Value> {
        let _slot = self
            .slots
            .try_acquire()
            .map_err(|_| "Wait for loading to finish")?;
        let lock = self.lock(endpoint).await;
        let _guard = lock.lock().await;
        let hash = format!("{:x}", Sha256::digest(endpoint.as_bytes()));
        let path = self.directory.join(format!("resource-{hash}.json"));
        let cached = read_cache(&path);
        if let Some(v) = cached.as_ref().filter(|v| {
            v["endpoint"] == endpoint
                && validate_resource(endpoint, &v["data"]).is_ok()
                && v["at"].as_i64().is_some_and(|t| {
                    chrono::Utc::now().timestamp_millis() - t < ttl
                        && t <= chrono::Utc::now().timestamp_millis()
                })
        }) {
            return Ok(v["data"].clone());
        }
        let data = match self.request(endpoint).await {
            Ok(data) => data,
            // The hero catalogue and the patch table change only with patches: an outdated
            // copy beats losing every portrait, matchup and patch filter while the provider is down.
            Err(_)
                if (endpoint == "heroes" || endpoint == PATCHES)
                    && cached.as_ref().is_some_and(|v| {
                        v["endpoint"] == endpoint && validate_resource(endpoint, &v["data"]).is_ok()
                    }) =>
            {
                return Ok(cached.unwrap()["data"].clone())
            }
            Err(error) => return Err(error),
        };
        validate_resource(endpoint, &data)?;
        let _ = atomic_json(
            &path,
            &json!({"endpoint":endpoint,"at":chrono::Utc::now().timestamp_millis(),"data":data}),
        );
        Ok(data)
    }
    pub async fn summary(&self, input: &str, days: u32, filter: Filter) -> Result<Value> {
        let _slot = self
            .summary_slots
            .try_acquire()
            .map_err(|_| "Wait for loading to finish")?;
        let id = account_id(input)?;
        stats::days(days)?;
        filter.validate()?;
        let source = if self.broker.is_some() {
            "STRATZ"
        } else {
            "OpenDota"
        };
        let key = format!("native-v1-{source}-{id}-{days}-{}", filter.key());
        let lock = self.lock(&key).await;
        let _guard = lock.lock().await;
        let path = self.directory.join(format!("{key}.json"));
        let cached = read_cache(&path).filter(|v| {
            v["accountId"] == id
                && v["days"] == days
                && v["source"] == source
                && v["filter"] == json!(filter)
                && complete_summary(v)
        });
        if let Some(v) = cached
            .as_ref()
            .filter(|v| fresh(v, 300_000) && v.get("warning").is_none())
        {
            return Ok(v.clone());
        }
        let result = if let Some(broker) = &self.broker {
            let (tx, rx) = oneshot::channel();
            broker
                .try_send(Pending {
                    id: id.clone(),
                    days,
                    filter: filter.clone(),
                    result: tx,
                })
                .map_err(|_| "The statistics queue is busy")?;
            rx.await.map_err(|_| "The statistics service has stopped")?
        } else {
            self.opendota_summary(&id, days, &filter).await
        }
        .and_then(|v| {
            complete_summary(&v).then_some(v).ok_or_else(|| {
                "The statistics service returned an incomplete player profile.".into()
            })
        });
        match result {
            Ok(v) => {
                let _ = atomic_json(&path, &v);
                Ok(v)
            }
            Err(e) => {
                if let Some(mut v) = cached {
                    v["stale"] = json!(true);
                    v["warning"] = json!(format!("{e} Showing a cached result."));
                    Ok(v)
                } else {
                    Err(e)
                }
            }
        }
    }
    pub async fn totals(&self, input: &str) -> Result<Value> {
        let id = account_id(input)?;
        let path = self.directory.join(format!("stratz-totals-{id}.json"));
        if let Some(v) = read_cache(&path).filter(|v| v["accountId"] == id && fresh(v, 86_400_000))
        {
            return Ok(v);
        }
        let broker = self.totals.as_ref().ok_or("STRATZ is not connected")?;
        let (tx, rx) = oneshot::channel();
        broker
            .try_send(Pending {
                id,
                days: 14,
                filter: Filter::default(),
                result: tx,
            })
            .map_err(|_| "The statistics queue is busy")?;
        let value = rx
            .await
            .map_err(|_| "The statistics service has stopped")??;
        if value["total"].is_object() {
            let _ = atomic_json(&path, &value);
        }
        Ok(value)
    }
    pub async fn draft_data(&self, ids: &[u64], bracket: &str) -> Result<Value> {
        let started = Instant::now();
        let result = self.draft_data_once(ids, bracket).await;
        net_log(
            &format!("service /v1/draft heroes={} bracket={bracket}", ids.len()),
            started,
            &result,
        );
        result
    }
    async fn draft_data_once(&self, ids: &[u64], bracket: &str) -> Result<Value> {
        crate::draft::validate_ids(ids)?;
        crate::draft::valid_bracket(bracket)?;
        let url = self
            .broker_url
            .as_ref()
            .ok_or("Position recommendations require a local STRATZ service; see Settings")?;
        let response = self
            .client
            .post(format!("{}/v1/draft", url.trim_end_matches('/')))
            .json(&json!({"ids":ids,"bracket":bracket}))
            .send()
            .await
            .map_err(|_| "Could not load STRATZ recommendations")?;
        let data = read_response(response).await?;
        crate::draft::validate_response(&data, ids, bracket)?;
        Ok(data)
    }
    /// Hero averages by position and rank bracket from the local STRATZ service.
    /// Hero averages of a bracket, kept on disk per hero for a day: they change slowly, and a
    /// restarted app then asks the service only for heroes it has not stored.
    pub async fn hero_averages(&self, ids: &[u64], bracket: &str) -> Result<Value> {
        crate::averages::Request {
            ids: ids.to_vec(),
            bracket: bracket.into(),
        }
        .validate()?;
        let now = chrono::Utc::now().timestamp_millis();
        let path = |id: u64| self.directory.join(format!("averages-{bracket}-{id}.json"));
        let mut rows = Vec::new();
        let mut missing = Vec::new();
        for &id in ids {
            let stored = read_cache(&path(id)).filter(|v| {
                v["rows"].is_array()
                    && v["at"]
                        .as_i64()
                        .is_some_and(|at| at <= now && now - at < AVERAGES_TTL)
            });
            match stored {
                Some(v) => rows.extend(v["rows"].as_array().cloned().unwrap_or_default()),
                None => missing.push(id),
            }
        }
        if !missing.is_empty() {
            let started = Instant::now();
            let result = self.hero_averages_once(&missing, bracket).await;
            net_log(
                &format!(
                    "service /v1/averages heroes={} bracket={bracket}",
                    missing.len()
                ),
                started,
                &result,
            );
            let fetched = result?["rows"].as_array().cloned().unwrap_or_default();
            for id in missing {
                let own: Vec<&Value> = fetched.iter().filter(|row| row["heroId"] == id).collect();
                let _ = atomic_json(&path(id), &json!({"at":now,"rows":own}));
            }
            rows.extend(fetched);
        }
        Ok(
            json!({"source":"STRATZ","bracket":bracket,"fetchedAt":chrono::Utc::now().to_rfc3339(),"rows":rows}),
        )
    }
    async fn hero_averages_once(&self, ids: &[u64], bracket: &str) -> Result<Value> {
        let request = crate::averages::Request {
            ids: ids.to_vec(),
            bracket: bracket.into(),
        };
        request.validate()?;
        let url = self
            .broker_url
            .as_ref()
            .ok_or("Hero averages require a local STRATZ service; see Settings")?;
        let response = self
            .client
            .post(format!("{}/v1/averages", url.trim_end_matches('/')))
            .json(&json!({"ids":ids,"bracket":bracket}))
            .send()
            .await
            .map_err(|_| "Could not load STRATZ hero averages")?;
        let data = read_response(response).await?;
        let rows_valid = data["rows"].as_array().is_some_and(|rows| {
            rows.iter().all(|row| {
                row["heroId"].as_u64().is_some_and(|id| ids.contains(&id))
                    && row["position"]
                        .as_u64()
                        .is_some_and(|p| (1..=5).contains(&p))
            })
        });
        if data["source"] != "STRATZ" || data["bracket"] != bracket || !rows_valid {
            return Err("Invalid hero averages response".into());
        }
        Ok(data)
    }
    async fn pause(&self, seconds: u64, message: &str) {
        *self.issue.lock().await = message.into();
        *self.cooldown.lock().await = Instant::now() + Duration::from_secs(seconds);
        *self.next.lock().await = Instant::now();
        self.paused.notify_waiters();
    }
    async fn resource_with_stale(&self, endpoint: &str) -> Result<Part> {
        match self.resource(endpoint, 300_000).await {
            Ok(v) => Ok(Part {
                data: v,
                stale: false,
                at: chrono::Utc::now().timestamp_millis(),
            }),
            Err(error) => {
                let hash = format!("{:x}", Sha256::digest(endpoint.as_bytes()));
                let cached = read_cache(&self.directory.join(format!("resource-{hash}.json")));
                match cached.filter(|v| {
                    v["endpoint"] == endpoint && validate_resource(endpoint, &v["data"]).is_ok()
                }) {
                    Some(v) => Ok(Part {
                        data: v["data"].clone(),
                        stale: true,
                        at: v["at"].as_i64().unwrap_or(0),
                    }),
                    None => Err(error),
                }
            }
        }
    }
    async fn opendota_summary(&self, id: &str, days: u32, filter: &Filter) -> Result<Value> {
        let endpoint = format!("players/{id}/matches?date={}&limit=100&significant=0&project=hero_id&project=duration&project=kills&project=deaths&project=assists&project=lane_role&project=gold_per_min&project=xp_per_min&project=game_mode&project=lobby_type", days + 1);
        let p = format!("players/{id}");
        let w = format!("players/{id}/wl");
        let (profile, matches, wl) = tokio::join!(
            self.resource_with_stale(&p),
            self.resource_with_stale(&endpoint),
            self.resource_with_stale(&w)
        );
        merge_opendota(id, days, filter, profile, matches, wl)
    }
    pub async fn player(&self, input: &str) -> Result<Value> {
        let _slot = self
            .player_slots
            .try_acquire()
            .map_err(|_| "Wait for loading to finish")?;
        let id = account_id(input)?;
        let path = self.directory.join(format!("{id}.json"));
        let cached = read_cache(&path).filter(|v| v["accountId"] == id);
        if let Some(v) = cached.as_ref().filter(|v| fresh(v, 300_000)) {
            return Ok(json!({"snapshot":v,"stale":false}));
        }
        let endpoints = [
            format!("players/{id}"),
            format!("players/{id}/wl"),
            format!("players/{id}/recentMatches"),
            format!("players/{id}/heroes"),
            "heroes".into(),
        ];
        let result: Result<Vec<_>> = join_all(endpoints.iter().map(|e| self.resource(e, 300_000)))
            .await
            .into_iter()
            .collect();
        match result {
            Ok(v) => {
                let snapshot = json!({"accountId":id,"fetchedAt":now(),"profile":v[0],"wl":v[1],"matches":v[2],"playerHeroes":v[3],"heroes":v[4]});
                let _ = atomic_json(&path, &snapshot);
                Ok(json!({"snapshot":snapshot,"stale":false}))
            }
            Err(e) => {
                if let Some(v) = cached {
                    Ok(json!({"snapshot":v,"stale":true,"warning":e}))
                } else {
                    Err(e)
                }
            }
        }
    }
    pub async fn history(&self, input: &str, offset: u32, load: HistoryLoad) -> Result<Value> {
        let mut request = crate::history::Request {
            id: input.into(),
            offset,
        };
        request.validate()?;
        let source = if self.broker_url.is_some() {
            "STRATZ"
        } else {
            "OpenDota"
        };
        let key = format!("history-{source}-{}", request.id);
        let path = self.directory.join(format!("{key}.json"));
        if load == HistoryLoad::Cached {
            let mut cached = read_json(&path, HISTORY_LIMIT)
                .ok()
                .flatten()
                .filter(|v| v["accountId"] == request.id && v["source"] == source)
                .unwrap_or(Value::Null);
            if cached.is_object() {
                cached["stale"] = json!(true);
            }
            return Ok(cached);
        }
        let _slot = self
            .player_slots
            .try_acquire()
            .map_err(|_| "Wait for loading to finish")?;
        let lock = self.lock(&key).await;
        let _guard = lock.lock().await;
        let cached = match read_json(&path, HISTORY_LIMIT) {
            Ok(value) => value,
            // Moved aside, not overwritten by the next page: it may hold history that is no
            // longer available, for example after the profile turned private.
            Err(()) => {
                let aside = path.with_file_name(format!(
                    "{key}.unreadable-{}.json",
                    chrono::Utc::now().format("%Y%m%dT%H%M%S")
                ));
                let _ = std::fs::rename(&path, aside);
                None
            }
        }
        .filter(|v| v["accountId"] == request.id && v["source"] == source);
        // Recorded matches join the history locally, so reopening the profile needs no fetch.
        if let Some(v) = cached.as_ref().filter(|v| {
            load == HistoryLoad::Recent
                && request.offset == 0
                && fresh(v, HISTORY_TTL)
                && v["stale"] != true
                && v.get("warning").is_none_or(Value::is_null)
        }) {
            return Ok(v.clone());
        }
        let started = Instant::now();
        let result: Result<Value> = async {
            if let Some(url) = &self.broker_url {
                let response = self.client.post(format!("{}/v1/history", url.trim_end_matches('/')))
                    .timeout(Duration::from_secs(55))
                    .json(&json!({"id":request.id,"offset":request.offset}))
                    .send().await.map_err(|_| "STRATZ: could not load history")?;
                let page = read_response(response).await?;
                if page["accountId"] != request.id || page["source"] != "STRATZ" || !page["matches"].is_array() || !page["profile"].is_object() {
                    return Err("STRATZ: invalid history response".into());
                }
                Ok(page)
            } else {
                let profile_endpoint = format!("players/{}", request.id);
                let history_endpoint = format!("players/{}/recentMatches", request.id);
                let (profile, matches) = tokio::join!(
                    self.resource_with_stale(&profile_endpoint),
                    self.resource_with_stale(&history_endpoint)
                );
                if profile.is_err() && matches.is_err() { return Err("OpenDota: profile and history unavailable".into()); }
                let partial = profile.is_err() || matches.is_err();
                let stale = partial || profile.as_ref().is_ok_and(|p| p.stale) || matches.as_ref().is_ok_and(|p| p.stale);
                // recentMatches returns at most 20 games: a full page is a recent sample, not all history.
                let limited = matches.as_ref().is_ok_and(|p| p.data.as_array().is_some_and(|rows| rows.len() >= 20));
                Ok(json!({"accountId":request.id,"source":"OpenDota","limited":limited,"profile":profile.map(|p|p.data).unwrap_or(json!({"profile":{}})),"matches":matches.as_ref().map(|p|p.data.clone()).unwrap_or(json!([])),"fetchedAt":now(),"hasMore":false,"nextOffset":0,"historyUnavailable":matches.is_err(),"stale":stale,"warning":if stale {Some("Some data is unavailable or loaded from cache.")} else {None}}))
            }
        }.await;
        net_log(
            &format!("history offset={} via {source}", request.offset),
            started,
            &result,
        );
        match result {
            Ok(page) => {
                let merged = crate::history::merge(cached.as_ref(), page);
                // Participants make history rows long; indentation would double the file.
                crate::store::atomic_json_compact(&path, &merged)?;
                Ok(merged)
            }
            Err(error) => match cached {
                Some(mut value) => {
                    value["stale"] = json!(true);
                    value["warning"] = json!(error);
                    Ok(value)
                }
                None => Err(error),
            },
        }
    }
    pub fn stratz_service(&self) -> bool {
        self.broker_url.is_some()
    }
    /// One match by ID from OpenDota (`match_details` shape). Not cached: the match journal
    /// keeps what it needs from it.
    pub async fn opendota_match(&self, id: u64) -> Result<Value> {
        let data = self.request(&format!("matches/{id}")).await?;
        crate::match_details::from_opendota(id, &data)
    }
    /// One match by ID from the STRATZ service (`match_details` shape).
    pub async fn stratz_match(&self, id: u64) -> Result<Value> {
        let url = self.broker_url.as_ref().ok_or("No STRATZ service")?;
        let started = Instant::now();
        let result: Result<Value> = async {
            let response = self
                .client
                .post(format!("{}/v1/match", url.trim_end_matches('/')))
                .timeout(Duration::from_secs(55))
                .json(&json!({"id":id.to_string()}))
                .send()
                .await
                .map_err(|_| "STRATZ: could not load the match")?;
            let value = read_response(response).await?;
            if value["source"] != "STRATZ"
                || value["match_id"] != id
                || value["players"].as_array().is_none_or(|p| p.len() != 10)
            {
                return Err("STRATZ: invalid match response".into());
            }
            Ok(value)
        }
        .await;
        net_log("match via STRATZ", started, &result);
        result
    }
    /// Game patches and their release dates (OpenDota constants), for the profile's patch
    /// filter: `[{name, date}]`, oldest first as published.
    pub async fn patches(&self) -> Result<Value> {
        let rows = self.resource(PATCHES, 86_400_000).await?;
        Ok(json!(rows
            .as_array()
            .into_iter()
            .flatten()
            .map(|p| json!({"name": p["name"], "date": p["date"]}))
            .collect::<Vec<_>>()))
    }
    /// The Steam profile country of an account from its OpenDota profile, for STRATZ profiles
    /// that lack one (STRATZ often has no `countryCode` where Steam has a location). A
    /// location rarely changes, so the profile is cached for a week; `null` when none is set.
    pub async fn country(&self, input: &str) -> Result<Value> {
        let id = account_id(input)?;
        let profile = self
            .resource(&format!("players/{id}"), 7 * 86_400_000)
            .await?;
        Ok(json!(crate::stats::country(
            &profile["profile"]["loccountrycode"]
        )))
    }
    pub async fn matchups(&self, ids: &[u64]) -> Result<Value> {
        if ids.len() > 5 {
            return Err("No more than five heroes".into());
        }
        let heroes = self.resource("heroes", 3_600_000).await?;
        let heroes = heroes.as_array().ok_or("Invalid hero catalogue")?;
        if ids.iter().any(|id| !heroes.iter().any(|h| h["id"] == *id)) {
            return Err("Unknown hero".into());
        }
        let rows: Result<Vec<_>> = join_all(ids.iter().map(|id| async move {
            let opponents = self
                .resource(&format!("heroes/{id}/matchups"), 3_600_000)
                .await?;
            Ok(json!({"heroId":id,"opponents":opponents}))
        }))
        .await
        .into_iter()
        .collect();
        Ok(json!(rows?))
    }
}
struct Part {
    data: Value,
    stale: bool,
    at: i64,
}
fn merge_opendota(
    id: &str,
    days: u32,
    filter: &Filter,
    profile: Result<Part>,
    history: Result<Part>,
    wl: Result<Part>,
) -> Result<Value> {
    if profile.is_err() && history.is_err() && wl.is_err() {
        return Err(history.err().unwrap());
    }
    let timestamp = chrono::Utc::now().timestamp();
    let cutoff = timestamp - days as i64 * 86400;
    let mut warning = Vec::new();
    let mut stale = false;
    let mut at = chrono::Utc::now().timestamp_millis();
    for (name, part) in [
        ("Profile", &profile),
        ("History for this period", &history),
        ("Overall statistics", &wl),
    ] {
        match part {
            Ok(p) => {
                at = at.min(p.at);
                if p.stale {
                    stale = true;
                    warning.push(format!("{name}: cached data."));
                }
            }
            Err(_) => warning.push(format!("{name} is temporarily unavailable.")),
        }
    }
    let history_unavailable = history.is_err();
    let raw = history
        .as_ref()
        .ok()
        .and_then(|p| p.data.as_array())
        .cloned()
        .unwrap_or_default();
    let mut seen = std::collections::HashSet::new();
    let mut matches: Vec<_> = raw
        .iter()
        .filter(|m| {
            let end = m["start_time"].as_i64().unwrap_or(0) + m["duration"].as_i64().unwrap_or(0);
            end >= cutoff
                && end <= timestamp
                && m["duration"].as_i64().unwrap_or(0) > 0
                && filter.includes(
                    m["game_mode"].as_i64().unwrap_or(-1),
                    m["lobby_type"].as_i64().unwrap_or(-1),
                )
                && seen.insert(m["match_id"].as_u64().unwrap_or(0))
        })
        .cloned()
        .collect();
    matches.sort_by_key(|m| {
        std::cmp::Reverse(
            m["start_time"].as_i64().unwrap_or(0) + m["duration"].as_i64().unwrap_or(0),
        )
    });
    let limited = raw.len() >= 100
        && raw.iter().all(|m| {
            m["start_time"].as_i64().unwrap_or(0) + m["duration"].as_i64().unwrap_or(0) >= cutoff
        });
    let fetched_at = chrono::DateTime::from_timestamp_millis(at)
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339();
    let mut result = json!({"accountId":id,"days":days,"filter":filter,"source":"OpenDota","fetchedAt":fetched_at,"profile":profile.map(|p|p.data).unwrap_or(json!({})),"heroes":stats::heroes(&matches),"matches":matches,"historyUnavailable":history_unavailable,"limited":limited,"stale":stale});
    if let Ok(wl) = wl {
        if let (Some(wins), Some(losses)) = (wl.data["win"].as_u64(), wl.data["lose"].as_u64()) {
            result["total"] = json!({"games":wins+losses,"wins":wins});
        }
    }
    if !warning.is_empty() {
        result["warning"] = json!(warning.join(" "));
    }
    Ok(result)
}
/// Where a history request may come from.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HistoryLoad {
    /// Only the saved history, marked stale; never the provider.
    Cached,
    /// The saved history while it is recent, otherwise the provider.
    Recent,
    /// The provider: a manual refresh or a further page.
    Network,
}

/// Largest provider cache file read back; larger ones count as absent.
const CACHE_LIMIT: u64 = 4 * 1024 * 1024;
/// Accumulated history keeps up to 10,000 matches with participants (about 4 KB each), so it
/// has its own limit above what the writer can produce.
const HISTORY_LIMIT: u64 = 64 * 1024 * 1024;
/// Disposable caches untouched this long are deleted at startup; every TTL is far shorter.
const CACHE_MAX_AGE: Duration = Duration::from_secs(30 * 86_400);
/// How long a saved history is shown instead of asking the provider again (milliseconds).
const HISTORY_TTL: i64 = 600_000;
/// How long stored hero averages stay in use (milliseconds): bracket averages over many
/// thousands of games move little within a week.
const AVERAGES_TTL: i64 = 7 * 86_400_000;

/// The fields the match table reads from every summary; a row without them is rejected for
/// that player only, so the rest of the roster still loads.
fn complete_summary(v: &Value) -> bool {
    v["profile"].is_object() && v["matches"].is_array() && v["heroes"].is_array()
}
fn read_cache(path: &std::path::Path) -> Option<Value> {
    read_json(path, CACHE_LIMIT).ok().flatten()
}
/// `Ok(None)` when the file does not exist; `Err` when it exists but is too large, unreadable
/// or not JSON. The size is checked before reading, so an oversized file is never loaded.
fn read_json(path: &std::path::Path, limit: u64) -> std::result::Result<Option<Value>, ()> {
    use std::io::Read;
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(()),
    };
    if file.metadata().map_err(|_| ())?.len() > limit {
        return Err(());
    }
    let mut bytes = Vec::new();
    // A file growing after the size check is still bounded.
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ())?;
    if bytes.len() as u64 > limit {
        return Err(());
    }
    serde_json::from_slice(&bytes).map(Some).map_err(|_| ())
}
/// Deletes provider caches (summaries, totals, OpenDota resources, player snapshots) not
/// written for `max_age`. Accumulated histories are kept: they can outlive a profile that
/// turns private. Anything else in the directory is left alone.
fn prune_cache(directory: &std::path::Path, max_age: Duration) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    let now = std::time::SystemTime::now();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(stem) = name.strip_suffix(".json") else {
            continue;
        };
        let disposable = ["native-v1-", "stratz-totals-", "resource-", "averages-"]
            .iter()
            .any(|prefix| stem.starts_with(prefix))
            || (!stem.is_empty() && stem.bytes().all(|b| b.is_ascii_digit()));
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .is_ok_and(|at| now.duration_since(at).is_ok_and(|age| age > max_age));
        if disposable && old {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}
fn fresh(v: &Value, ttl: i64) -> bool {
    v["fetchedAt"]
        .as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .is_some_and(|t| {
            let age = chrono::Utc::now().timestamp_millis() - t.timestamp_millis();
            age >= 0 && age < ttl
        })
}
const PATCHES: &str = "constants/patch";
fn validate_resource(endpoint: &str, v: &Value) -> Result<()> {
    let valid = if endpoint == PATCHES {
        v.as_array().is_some_and(|rows| {
            !rows.is_empty()
                && rows.len() <= 1000
                && rows.iter().all(|p| {
                    p["name"]
                        .as_str()
                        .is_some_and(|n| !n.is_empty() && n.len() <= 20)
                        && p["date"]
                            .as_str()
                            .is_some_and(|d| chrono::DateTime::parse_from_rfc3339(d).is_ok())
                })
        })
    } else if endpoint.ends_with("/wl") {
        v["win"].as_u64().is_some() && v["lose"].as_u64().is_some()
    } else if endpoint == "heroes" {
        v.as_array().is_some_and(|a| {
            a.iter().all(|h| {
                h["id"].is_u64() && h["localized_name"].is_string() && h["roles"].is_array()
            })
        })
    } else if endpoint.contains("/matches?") || endpoint.ends_with("/recentMatches") {
        v.as_array().is_some_and(|a| {
            a.iter().all(|m| {
                [
                    "match_id",
                    "hero_id",
                    "start_time",
                    "duration",
                    "player_slot",
                ]
                .iter()
                .all(|k| m[k].is_number())
            })
        })
    } else if endpoint.contains("/heroes") || endpoint.ends_with("/matchups") {
        v.is_array()
    } else {
        v.is_object() && (v["profile"].is_null() || v["profile"].is_object())
    };
    if valid {
        Ok(())
    } else {
        Err("OpenDota returned an unexpected data format.".into())
    }
}
async fn batch_worker(
    mut rx: mpsc::Receiver<Pending>,
    client: reqwest::Client,
    url: String,
    route: &'static str,
) {
    let slots = Arc::new(Semaphore::new(2));
    let cooldown = Arc::new(Mutex::new(Instant::now()));
    let mut waiting = Vec::new();
    loop {
        if waiting.is_empty() {
            match rx.recv().await {
                Some(p) => waiting.push(p),
                None => break,
            }
        }
        // Sliding window: a roster's ten lookups can trickle in over IPC on a slow
        // machine. Wait 40 ms after the latest request (200 ms at most) unless a
        // full batch of five is already waiting.
        let deadline = Instant::now() + Duration::from_millis(200);
        while waiting.len() < 30 && waiting.len() % 5 != 0 {
            let left = deadline.saturating_duration_since(Instant::now());
            match tokio::time::timeout(left.min(Duration::from_millis(40)), rx.recv()).await {
                Ok(Some(p)) => waiting.push(p),
                _ => break,
            }
        }
        while waiting.len() < 30 {
            match rx.try_recv() {
                Ok(p) => waiting.push(p),
                Err(_) => break,
            }
        }
        let first = waiting.remove(0);
        let mut batch = vec![first];
        let mut i = 0;
        while i < waiting.len() && batch.len() < 5 {
            if waiting[i].days == batch[0].days && waiting[i].filter == batch[0].filter {
                batch.push(waiting.remove(i));
            } else {
                i += 1
            }
        }
        let permit = slots.clone().acquire_owned().await.unwrap();
        let client = client.clone();
        let url = url.clone();
        let cooldown = cooldown.clone();
        tokio::spawn(async move {
            let _permit = permit;
            let started = Instant::now();
            let size = batch.len();
            let days = batch[0].days;
            let result = async {
                if Instant::now() < *cooldown.lock().await {
                    return Err(
                        "Statistics service rate limit reached. Try again in one minute.".into(),
                    );
                }
                let ids: Vec<_> = batch.iter().map(|p| p.id.clone()).collect();
                let response = client
                    .post(format!("{}/v1/{route}", url.trim_end_matches('/')))
                    .timeout(Duration::from_secs(50))
                    .json(&json!({"ids":ids,"days":batch[0].days,"filter":batch[0].filter}))
                    .send()
                    .await
                    .map_err(|_| "The statistics service did not respond.")?;
                if response.status().as_u16() == 429 {
                    *cooldown.lock().await = Instant::now() + Duration::from_secs(60);
                }
                read_response(response).await
            }
            .await;
            net_log(
                &format!("service /v1/{route} ids={size} days={days}"),
                started,
                &result,
            );
            for pending in batch {
                let value = result.as_ref().map_err(Clone::clone).and_then(|v| {
                    v["summaries"]
                        .as_array()
                        .and_then(|rows| {
                            rows.iter().find(|row| {
                                row["accountId"] == pending.id
                                    && row["days"] == pending.days
                                    && row["source"] == "STRATZ"
                                    && row["filter"] == json!(pending.filter)
                            })
                        })
                        .cloned()
                        .ok_or("The service did not return a player profile.".into())
                });
                let _ = pending.result.send(value);
            }
        });
    }
}

#[cfg(test)]
mod partial_tests {
    use super::*;
    #[test]
    fn patch_table_needs_names_and_dates() {
        let valid = json!([{"name":"7.39","date":"2025-05-22T00:00:00Z","id":58},{"name":"7.40","date":"2025-09-10T00:00:00Z","id":59}]);
        assert!(validate_resource(PATCHES, &valid).is_ok());
        assert!(validate_resource(PATCHES, &json!([])).is_err());
        assert!(validate_resource(PATCHES, &json!([{"name":"7.40","date":"soon"}])).is_err());
        assert!(validate_resource(PATCHES, &json!([{"date":"2025-09-10T00:00:00Z"}])).is_err());
    }
    #[tokio::test]
    async fn country_comes_from_a_cached_opendota_profile_for_a_week() {
        let dir = tempfile::tempdir().unwrap();
        let api = Api::new(dir.path().into(), None).unwrap();
        let day = 86_400_000;
        for (id, country, age) in [("5", json!("fi"), 6 * day), ("6", Value::Null, day)] {
            let endpoint = format!("players/{id}");
            let hash = format!("{:x}", Sha256::digest(endpoint.as_bytes()));
            let at = chrono::Utc::now().timestamp_millis() - age;
            let data = json!({"profile":{"account_id":id.parse::<u64>().unwrap(),"loccountrycode":country}});
            atomic_json(
                &dir.path().join(format!("resource-{hash}.json")),
                &json!({"endpoint":endpoint,"at":at,"data":data}),
            )
            .unwrap();
        }
        assert_eq!(api.country("5").await.unwrap(), "FI");
        assert!(api.country("6").await.unwrap().is_null());
        assert!(api.country("x").await.is_err());
    }
    /// A history page with ten named players, as the STRATZ service returns it.
    fn history_page() -> Value {
        let players: Vec<_> = (1..=10).map(|id| json!({"steamAccountId":id,"steamAccount":{"name":format!("Fixture Player {id}")},
            "heroId":id,"isRadiant":id <= 5,"kills":10,"deaths":5,"assists":15,"goldPerMinute":500,"experiencePerMinute":600,
            "numLastHits":200,"numDenies":10,"networth":20000,"heroDamage":30000,"towerDamage":5000,"heroHealing":1000,"imp":10,
            "position":"POSITION_1"})).collect();
        let raw = json!({"steamAccountId":1,"steamAccount":{"name":"Fixture Own"},"matches":[{"id":999999,"endDateTime":1700000000,
            "durationSeconds":1800,"didRadiantWin":true,"gameMode":22,"lobbyType":7,"players":players}]});
        crate::history::page(
            &raw,
            &crate::history::Request {
                id: "1".into(),
                offset: 0,
            },
        )
        .unwrap()
    }
    async fn serve(route: &'static str, body: Value) -> (String, tokio::task::JoinHandle<()>) {
        use axum::{routing::post, Json, Router};
        let router = Router::new().route(
            route,
            post(move || {
                let body = body.clone();
                async move { Json(body) }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        (
            format!("http://{addr}"),
            tokio::spawn(async move { axum::serve(listener, router).await.unwrap() }),
        )
    }
    #[tokio::test]
    async fn long_history_past_the_cache_limit_stays_readable_and_grows() {
        let page = history_page();
        let mut saved = page.clone();
        saved["matches"] = json!((1..=2000)
            .map(|id| {
                let mut row = page["matches"][0].clone();
                row["match_id"] = json!(id);
                row
            })
            .collect::<Vec<_>>());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history-STRATZ-1.json");
        crate::store::atomic_json_compact(&path, &saved).unwrap();
        assert!(std::fs::metadata(&path).unwrap().len() > CACHE_LIMIT);
        let (url, server) = serve("/v1/history", page).await;
        let api = Api::new(dir.path().into(), Some(url)).unwrap();
        assert_eq!(
            api.history("1", 0, HistoryLoad::Cached).await.unwrap()["matches"]
                .as_array()
                .unwrap()
                .len(),
            2000
        );
        let after = api.history("1", 25, HistoryLoad::Network).await.unwrap();
        assert_eq!(after["matches"].as_array().unwrap().len(), 2001);
        server.abort();
    }
    #[tokio::test]
    async fn recent_history_is_served_from_disk_until_a_refresh() {
        use axum::{routing::post, Json, Router};
        let requests = Arc::new(Mutex::new(0));
        let (seen, page) = (requests.clone(), history_page());
        let router = Router::new().route(
            "/v1/history",
            post(move || {
                let (seen, page) = (seen.clone(), page.clone());
                async move {
                    *seen.lock().await += 1;
                    Json(page)
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let dir = tempfile::tempdir().unwrap();
        let api = Api::new(dir.path().into(), Some(format!("http://{addr}"))).unwrap();
        api.history("1", 0, HistoryLoad::Recent).await.unwrap();
        let reopened = api.history("1", 0, HistoryLoad::Recent).await.unwrap();
        assert_eq!(reopened["matches"].as_array().unwrap().len(), 1);
        assert_eq!(reopened["stale"], false);
        assert_eq!(*requests.lock().await, 1);
        api.history("1", 0, HistoryLoad::Network).await.unwrap();
        assert_eq!(*requests.lock().await, 2);
        // An old copy is fetched again.
        let path = dir.path().join("history-STRATZ-1.json");
        let mut saved: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        saved["fetchedAt"] =
            json!((chrono::Utc::now() - chrono::Duration::minutes(11)).to_rfc3339());
        atomic_json(&path, &saved).unwrap();
        api.history("1", 0, HistoryLoad::Recent).await.unwrap();
        assert_eq!(*requests.lock().await, 3);
        task.abort();
    }
    #[tokio::test]
    async fn unreadable_history_is_set_aside_instead_of_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history-STRATZ-1.json");
        std::fs::write(&path, b"{\"accountId\":\"1\",\"matches\":[").unwrap();
        let (url, server) = serve("/v1/history", history_page()).await;
        let api = Api::new(dir.path().into(), Some(url)).unwrap();
        assert_eq!(
            api.history("1", 0, HistoryLoad::Network).await.unwrap()["matches"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let aside: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("history-STRATZ-1.unreadable-")
            })
            .collect();
        assert_eq!(aside.len(), 1);
        assert_eq!(
            std::fs::read(aside[0].path()).unwrap(),
            b"{\"accountId\":\"1\",\"matches\":["
        );
        server.abort();
    }
    #[tokio::test]
    async fn incomplete_service_summary_is_an_error_and_never_cached() {
        let (url, server) = serve(
            "/v1/summaries",
            json!({"summaries":[{"accountId":"1","days":14,"source":"STRATZ",
            "filter":{"mode":"normal","rankedOnly":false}}]}),
        )
        .await;
        let dir = tempfile::tempdir().unwrap();
        let api = Api::new(dir.path().into(), Some(url)).unwrap();
        assert!(api.summary("1", 14, Filter::default()).await.is_err());
        assert!(!dir
            .path()
            .join("native-v1-STRATZ-1-14-normal.json")
            .exists());
        server.abort();
    }
    #[test]
    fn oversized_cache_files_are_refused_before_reading() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.json");
        std::fs::write(&path, b"{\"a\":\"0123456789\"}").unwrap();
        assert_eq!(
            read_json(&path, 64).unwrap(),
            Some(json!({"a":"0123456789"}))
        );
        assert!(read_json(&path, 8).is_err());
        assert_eq!(
            read_json(&dir.path().join("missing.json"), 64).unwrap(),
            None
        );
        std::fs::write(&path, b"{").unwrap();
        assert!(read_json(&path, 64).is_err());
    }
    #[test]
    fn old_disposable_cache_entries_are_pruned_and_history_kept() {
        let dir = tempfile::tempdir().unwrap();
        let old = std::time::SystemTime::now() - Duration::from_secs(40 * 86_400);
        for name in [
            "native-v1-STRATZ-1-14-normal.json",
            "stratz-totals-1.json",
            "resource-ab.json",
            "55.json",
            "history-STRATZ-1.json",
            "notes.txt",
            "native-v1-STRATZ-2-14-normal.json",
        ] {
            let file = std::fs::File::create(dir.path().join(name)).unwrap();
            if name != "native-v1-STRATZ-2-14-normal.json" {
                file.set_modified(old).unwrap();
            }
        }
        prune_cache(dir.path(), Duration::from_secs(30 * 86_400));
        let mut left: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert_eq!(
            left,
            [
                "history-STRATZ-1.json",
                "native-v1-STRATZ-2-14-normal.json",
                "notes.txt"
            ]
        );
    }
    #[tokio::test]
    async fn trickling_roster_requests_still_form_two_batches_of_five() {
        use axum::{routing::post, Json, Router};
        let seen = Arc::new(Mutex::new(Vec::<usize>::new()));
        let record = seen.clone();
        let server = Router::new().route(
            "/v1/summaries",
            post(move |Json(body): Json<Value>| {
                let record = record.clone();
                async move {
                    record
                        .lock()
                        .await
                        .push(body["ids"].as_array().unwrap().len());
                    Json(json!({"summaries":[]}))
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, server).await.unwrap() });
        let (tx, rx) = mpsc::channel(64);
        tokio::spawn(batch_worker(
            rx,
            client(),
            format!("http://{addr}"),
            "summaries",
        ));
        let mut replies = Vec::new();
        // Ten lookups arriving 15 ms apart, as over IPC on a slow runner.
        for id in 1..=10 {
            let (result, reply) = oneshot::channel();
            tx.send(Pending {
                id: id.to_string(),
                days: 14,
                filter: Filter::default(),
                result,
            })
            .await
            .unwrap();
            replies.push(reply);
            tokio::time::sleep(Duration::from_millis(15)).await;
        }
        for reply in replies {
            let _ = reply.await;
        }
        assert_eq!(*seen.lock().await, vec![5, 5]);
        task.abort();
    }
    #[tokio::test]
    async fn draft_client_accepts_missing_heroes_but_rejects_invalid_rows() {
        use axum::{routing::post, Json, Router};
        let valid = json!({"source":"STRATZ","fetchedAt":"2026-10-13T00:00:00Z",
            "positions":[{"heroId":3,"position":"POSITION_5","matchCount":1000,"winCount":500}],
            "matchups":[{"heroId":1,"vs":[],"with":[]}]});
        let response = Arc::new(Mutex::new(valid.clone()));
        let body = response.clone();
        let server = Router::new().route(
            "/v1/draft",
            post(move |Json(request): Json<Value>| {
                let body = body.clone();
                async move {
                    assert_eq!(request["ids"], json!([1, 2]));
                    Json(body.lock().await.clone())
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, server).await.unwrap();
        });
        let dir = tempfile::tempdir().unwrap();
        let api = Api::new(dir.path().into(), Some(format!("http://{addr}"))).unwrap();
        assert_eq!(api.draft_data(&[1, 2], "ALL").await.unwrap(), valid);
        for rows in [
            json!([{"heroId":1,"vs":[],"with":[]},{"heroId":1,"vs":[],"with":[]}]),
            json!([{"heroId":99,"vs":[],"with":[]}]),
            json!([{"heroId":1,"vs":null,"with":[]}]),
        ] {
            response.lock().await["matchups"] = rows;
            assert!(api.draft_data(&[1, 2], "ALL").await.is_err());
        }
        task.abort();
    }
    #[tokio::test]
    async fn averages_client_checks_source_bracket_and_heroes() {
        use axum::{routing::post, Json, Router};
        let valid = json!({"source":"STRATZ","fetchedAt":"2026-10-27T00:00:00Z","bracket":"DIVINE_IMMORTAL",
            "rows":[{"heroId":33,"position":3,"time":30,"matchCount":400,"kills":5.0,"deaths":6.0,"assists":12.0}]});
        let response = Arc::new(Mutex::new(valid.clone()));
        let requests = Arc::new(Mutex::new(Vec::<Value>::new()));
        let (body, seen) = (response.clone(), requests.clone());
        let server = Router::new().route(
            "/v1/averages",
            post(move |Json(request): Json<Value>| {
                let (body, seen) = (body.clone(), seen.clone());
                async move {
                    let mut answer = body.lock().await.clone();
                    // Only the requested heroes, as the service answers.
                    if let Some(rows) = answer["rows"].as_array_mut() {
                        rows.retain(|row| {
                            row["heroId"] == 99
                                || request["ids"].as_array().unwrap().contains(&row["heroId"])
                        });
                    }
                    seen.lock().await.push(request);
                    Json(answer)
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, server).await.unwrap();
        });
        let url = Some(format!("http://{addr}"));
        let dir = tempfile::tempdir().unwrap();
        let api = Api::new(dir.path().into(), url.clone()).unwrap();
        let first = api.hero_averages(&[33], "DIVINE_IMMORTAL").await.unwrap();
        assert_eq!(
            (&first["source"], &first["bracket"]),
            (&json!("STRATZ"), &json!("DIVINE_IMMORTAL"))
        );
        assert_eq!(first["rows"], valid["rows"]);
        // Kept on disk: a restarted app asks only for heroes it has not stored.
        let restarted = Api::new(dir.path().into(), url.clone()).unwrap();
        let again = restarted.hero_averages(&[33, 62], "DIVINE_IMMORTAL").await;
        assert_eq!(
            *requests.lock().await,
            vec![
                json!({"ids":[33],"bracket":"DIVINE_IMMORTAL"}),
                json!({"ids":[62],"bracket":"DIVINE_IMMORTAL"})
            ]
        );
        assert_eq!(again.unwrap()["rows"], valid["rows"], "hero 62 has no rows");
        let file = dir.path().join("averages-DIVINE_IMMORTAL-33.json");
        let mut stored: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
        // Bracket averages barely move within a patch: a few days old is still in use.
        for (days, expected) in [(3, 2), (8, 3)] {
            stored["at"] = json!(chrono::Utc::now().timestamp_millis() - days * 86_400_000);
            std::fs::write(&file, stored.to_string()).unwrap();
            restarted
                .hero_averages(&[33], "DIVINE_IMMORTAL")
                .await
                .unwrap();
            assert_eq!(requests.lock().await.len(), expected, "{days} days old");
        }
        for (field, value) in [
            ("source", json!("OpenDota")),
            ("bracket", json!("ALL")),
            ("rows", json!([{"heroId":99,"position":3}])),
            ("rows", Value::Null),
        ] {
            *response.lock().await = valid.clone();
            response.lock().await[field] = value;
            let fresh = tempfile::tempdir().unwrap();
            let api = Api::new(fresh.path().into(), url.clone()).unwrap();
            assert!(api.hero_averages(&[33], "DIVINE_IMMORTAL").await.is_err());
            assert!(!fresh
                .path()
                .join("averages-DIVINE_IMMORTAL-33.json")
                .exists());
        }
        assert!(api.hero_averages(&[33], "IMMORTAL").await.is_err());
        let offline = Api::new(tempfile::tempdir().unwrap().path().into(), None).unwrap();
        assert!(offline
            .hero_averages(&[33], "ALL")
            .await
            .unwrap_err()
            .contains("local STRATZ service"));
        task.abort();
    }

    fn part(data: Value, stale: bool) -> Result<Part> {
        Ok(Part {
            data,
            stale,
            at: chrono::Utc::now().timestamp_millis(),
        })
    }
    #[test]
    fn failed_history_preserves_profile_and_totals_without_claiming_zero_games() {
        let result = merge_opendota(
            "1",
            14,
            &Filter::default(),
            part(json!({"rank_tier":80}), true),
            Err("HTTP 522".into()),
            part(json!({"win":300,"lose":200}), true),
        )
        .unwrap();
        assert_eq!(result["profile"]["rank_tier"], 80);
        assert_eq!(result["total"]["games"], 500);
        assert_eq!(result["historyUnavailable"], true);
        assert_eq!(result["stale"], true);
        assert!(result["warning"].is_string());
    }
    #[test]
    fn empty_successful_history_is_different_from_a_failed_request() {
        let result = merge_opendota(
            "1",
            14,
            &Filter::default(),
            Err("profile unavailable".into()),
            part(json!([]), false),
            Err("totals unavailable".into()),
        )
        .unwrap();
        assert_eq!(result["historyUnavailable"], false);
        assert!(result.get("total").is_none());
        assert!(merge_opendota(
            "1",
            14,
            &Filter::default(),
            Err("offline".into()),
            Err("offline".into()),
            Err("offline".into())
        )
        .is_err());
    }
}
