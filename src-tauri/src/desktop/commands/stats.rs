//! Statistics: heroes, players, matches, history and drafts, from the provider and the
//! game's own records, and the links to other statistics sites.
use super::args::{lenient, parse, Heroes, Id};
use crate::desktop::Desktop;
use crate::{api::HistoryLoad, stats::Filter, store::Result};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
struct Site {
    #[serde(default, deserialize_with = "lenient")]
    id: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    site: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Items {
    #[serde(default, deserialize_with = "lenient")]
    hero_id: Option<u64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct History {
    #[serde(default, deserialize_with = "lenient")]
    id: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    offset: Option<u64>,
    #[serde(default, deserialize_with = "lenient")]
    cached_only: Option<bool>,
    #[serde(default, deserialize_with = "lenient")]
    refresh: Option<bool>,
}
#[derive(Deserialize)]
struct Parties {
    #[serde(default, deserialize_with = "lenient")]
    ids: Option<Vec<String>>,
}
#[derive(Deserialize)]
struct Period {
    #[serde(default, deserialize_with = "lenient")]
    id: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    days: Option<u64>,
    /// No filter is the default one; a filter that does not parse is `None`.
    #[serde(default = "default_filter", deserialize_with = "lenient")]
    filter: Option<Filter>,
}
fn default_filter() -> Option<Filter> {
    Some(Filter::default())
}

pub(in crate::desktop) async fn handle(
    state: &Desktop,
    command: &str,
    args: &Value,
) -> Result<Value> {
    match command {
        "live:get" => Ok(state.live.read().await.clone()),
        "player:site" | "match:site" => {
            let link = parse::<Site>(args)?;
            let (id, site) = (
                link.id.as_deref().unwrap_or(""),
                link.site.as_deref().unwrap_or(""),
            );
            let url = if command == "player:site" {
                crate::player_sites::url(id, site)?
            } else {
                crate::player_sites::match_url(id, site)?
            };
            state.mode.open_external(&url).await?;
            Ok(json!(url))
        }
        "heroes:get" => state.api().heroes().await,
        "items:get" => {
            let hero = parse::<Items>(args)?.hero_id.ok_or("Invalid own hero")?;
            state.api().item_stats(hero).await
        }
        "patches:get" => state.api().patches().await,
        "country:get" => state.api().country(parse::<Id>(args)?.id()).await,
        "totals:get" => state.api().totals(parse::<Id>(args)?.id()).await,
        "player:get" => state.api().player(parse::<Id>(args)?.id()).await,
        "draft:data" => {
            let heroes = parse::<Heroes>(args)?;
            state
                .api()
                .draft_data(heroes.ids()?, heroes.bracket())
                .await
        }
        "averages:get" => {
            let heroes = parse::<Heroes>(args)?;
            state
                .api()
                .hero_averages(heroes.ids()?, heroes.bracket())
                .await
        }
        "matchups:get" => state.api().matchups(parse::<Heroes>(args)?.ids()?).await,
        "parties:get" => {
            let ids = parse::<Parties>(args)?
                .ids
                .filter(|ids| ids.len() <= 10)
                .ok_or("Invalid accounts")?;
            state.api().parties(&ids).await
        }
        "history:get" => {
            let request = parse::<History>(args)?;
            let offset = request.offset.unwrap_or(0);
            if offset > 5000 {
                return Err("History limit exceeded".into());
            }
            let id = crate::store::account_id(request.id.as_deref().unwrap_or(""))?;
            let load = if request.cached_only.unwrap_or(false) {
                HistoryLoad::Cached
            } else if request.refresh.unwrap_or(false) || offset > 0 {
                HistoryLoad::Network
            } else {
                HistoryLoad::Recent
            };
            let history = state.api().history(&id, offset as u32, load).await;
            // Matches recorded from the game stay visible when the provider has none.
            let recorded = state.store.lock().await.recorded(&id);
            let fallback = |warning: Option<String>| {
                crate::journal::local_history(&id, &state.api().info()["source"], warning)
            };
            match history {
                Ok(history) if history.is_object() => Ok(crate::journal::merge(history, &recorded)),
                Ok(_) if !recorded.is_empty() => {
                    Ok(crate::journal::merge(fallback(None), &recorded))
                }
                Err(error) if !recorded.is_empty() => Ok(crate::journal::merge(
                    fallback(Some(error.to_string())),
                    &recorded,
                )),
                other => other,
            }
        }
        "summary:get" => {
            let period = parse::<Period>(args)?;
            let days = period
                .days
                .filter(|days| *days <= 90)
                .ok_or("Invalid period")?;
            let filter = period.filter.ok_or("Invalid filter")?;
            state
                .api()
                .summary(period.id.as_deref().unwrap_or(""), days as u32, filter)
                .await
        }
        "period:get" => {
            let period = parse::<Period>(args)?;
            let days = period.days.unwrap_or(30);
            if days > 90 {
                return Err("Invalid period".into());
            }
            let v = state
                .api()
                .summary(
                    period.id.as_deref().unwrap_or(""),
                    days as u32,
                    Filter::default(),
                )
                .await?;
            Ok(json!({"accountId":v["accountId"],"fetchedAt":v["fetchedAt"],"heroes":v["heroes"]}))
        }
        _ => Err("Unknown command".into()),
    }
}
