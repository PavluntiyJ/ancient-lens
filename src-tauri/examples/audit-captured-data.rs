//! Offline replay of public API captures. No token, network or game process access.
//! cargo run --no-default-features --example audit-captured-data -- <capture directory>
use ancient_lens::{draft, history, stats};
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let directory = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("Capture directory required")?,
    );
    let read = |name: &str| -> Result<Value, Box<dyn std::error::Error>> {
        Ok(serde_json::from_slice(&fs::read(directory.join(name))?)?)
    };
    let timestamp = read("captured-at.json")?["unix"]
        .as_i64()
        .ok_or("Missing timestamp")?;
    let mut summaries = Vec::new();
    let mut histories = Vec::new();
    let mut drafts = Vec::new();
    for entry in fs::read_dir(&directory)? {
        let path = entry?.path();
        let name = path.file_name().unwrap().to_string_lossy();
        if !name.ends_with(".json") {
            continue;
        }
        let raw = read(&name)?;
        if name.starts_with("players-") || name.starts_with("public-players-") {
            for row in raw["data"]["players"].as_array().ok_or("Missing players")? {
                let id = row["steamAccountId"]
                    .as_u64()
                    .ok_or("Missing ID")?
                    .to_string();
                for days in [7, 14, 30, 90] {
                    for mode in ["normal", "all", "turbo"] {
                        for ranked_only in [false, true] {
                            let filter = stats::Filter {
                                mode: mode.into(),
                                ranked_only,
                            };
                            summaries.push(stats::from_stratz(row, &id, days, &filter, timestamp)?);
                        }
                    }
                }
            }
        } else if name.starts_with("history-") {
            let parts: Vec<_> = name.trim_end_matches(".json").split('-').collect();
            let request = history::Request {
                id: parts[1].into(),
                offset: parts[2].parse()?,
            };
            let query = fs::read_to_string(path.with_extension("graphql"))?;
            assert_eq!(
                history::query(&request),
                query,
                "Capture must use the production history query"
            );
            histories.push(history::page(&raw["data"]["player"], &request)?);
        } else if name.starts_with("draft-")
            || name.starts_with("public-draft-")
            || name.starts_with("ranked-draft-")
        {
            let data = &raw["data"]["heroStats"];
            if data.is_null() {
                continue;
            }
            let query = fs::read_to_string(path.with_extension("graphql"))?;
            let ids: Vec<u64> = query
                .split("heroIds:[")
                .nth(1)
                .ok_or("Missing query IDs")?
                .split(']')
                .next()
                .unwrap()
                .split(',')
                .map(str::parse)
                .collect::<Result<_, _>>()?;
            assert_eq!(
                draft::query(&ids, true, "ALL"),
                query,
                "Capture must use the production draft query"
            );
            draft::validate_data(data, &ids, true)?;
            drafts.push(data.clone());
        }
    }
    let output =
        json!({"timestamp":timestamp,"summaries":summaries,"histories":histories,"drafts":drafts});
    fs::write(
        directory.join("normalized.json"),
        serde_json::to_vec(&output)?,
    )?;
    println!(
        "Replay passed: {} summaries, {} history pages, {} draft batches",
        summaries.len(),
        histories.len(),
        drafts.len()
    );
    Ok(())
}
