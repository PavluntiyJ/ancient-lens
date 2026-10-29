//! New-version notice: the app asks GitHub for its release list and compares versions here.
//! The request carries no app version, account, ID or setting; GitHub sees the IP address.
//! Nothing is downloaded or installed.
use crate::store::Result;
use serde_json::{json, Value};
use std::time::{Duration, Instant};

const REPOSITORY: &str = "PavluntiyJ/ancient-lens";
/// `releases/latest` skips prereleases, and every release so far is one, so the list is read.
const RELEASES: &str = "https://api.github.com/repos/PavluntiyJ/ancient-lens/releases?per_page=20";
/// After start, so the check never competes with loading the match screen.
pub const FIRST_CHECK: Duration = Duration::from_secs(30);
/// While the app keeps running, for example in the tray.
pub const INTERVAL: Duration = Duration::from_secs(12 * 3600);

/// `0.6.1` or `v0.6.1`; other tags (`v0.7.0-rc.1`, `nightly`) are not versions here.
pub fn version(text: &str) -> Option<(u64, u64, u64)> {
    let parts: Vec<_> = text.strip_prefix('v').unwrap_or(text).split('.').collect();
    let number = |part: &str| {
        (!part.is_empty() && part.len() <= 9 && part.bytes().all(|b| b.is_ascii_digit()))
            .then(|| part.parse().ok())
            .flatten()
    };
    match parts.as_slice() {
        [major, minor, patch] => Some((number(major)?, number(minor)?, number(patch)?)),
        _ => None,
    }
}
pub fn format((major, minor, patch): (u64, u64, u64)) -> String {
    format!("{major}.{minor}.{patch}")
}
/// The newest published release above `current`, or `None`. Drafts are left out; prereleases
/// count. The link is built from the tag, so it can only point at this repository.
pub fn newest(releases: &Value, current: &str) -> Option<Value> {
    let current = version(current)?;
    let (found, release, tag) = releases
        .as_array()?
        .iter()
        .filter(|release| release["draft"] != true)
        .filter_map(|release| {
            let tag = release["tag_name"].as_str()?;
            let found = version(tag)?;
            (found > current).then_some((found, release, tag))
        })
        .max_by_key(|(found, _, _)| *found)?;
    Some(json!({
        "version": format(found),
        "url": format!("https://github.com/{REPOSITORY}/releases/tag/{tag}"),
        "prerelease": release["prerelease"] == true,
        "publishedAt": release["published_at"].as_str(),
    }))
}
pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        // GitHub refuses requests without one; it names the app, not its version.
        .user_agent("AncientLens")
        .build()
        .expect("TLS client")
}
/// The release list. A failure is logged as one line and otherwise stays silent.
pub async fn fetch(client: &reqwest::Client) -> Result<Value> {
    let started = Instant::now();
    let result = async {
        let response = client
            .get(RELEASES)
            .header("accept", "application/vnd.github+json")
            .header("x-github-api-version", "2022-11-28")
            .send()
            .await
            .map_err(|_| "GitHub is unreachable".to_string())?;
        if !response.status().is_success() {
            return Err(format!("HTTP {}", response.status().as_u16()));
        }
        crate::api::read_response(response).await
    }
    .await;
    crate::api::net_log("github/releases", started, &result);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_are_plain_numbers() {
        assert_eq!(version("0.6.1"), Some((0, 6, 1)));
        assert_eq!(version("v10.0.12"), Some((10, 0, 12)));
        for tag in [
            "v0.7.0-rc.1",
            "nightly",
            "v1.2",
            "1.2.3.4",
            "+1.2.3",
            "v1..3",
            "vv1.2.3",
        ] {
            assert_eq!(version(tag), None, "{tag}");
        }
        assert!(version("0.10.0") > version("0.9.9"));
    }

    #[test]
    fn the_newest_published_release_above_this_version() {
        let releases = json!([
            {"tag_name": "v9.0.0", "draft": true, "prerelease": false},
            {"tag_name": "v0.6.1", "draft": false, "prerelease": true},
            {"tag_name": "v0.7.0", "draft": false, "prerelease": true, "published_at": "2026-11-02T10:00:00Z"},
            {"tag_name": "v0.6.2", "draft": false, "prerelease": false},
            {"tag_name": "v0.8.0-rc.1", "draft": false, "prerelease": true},
            {"tag_name": "nightly", "draft": false},
        ]);
        assert_eq!(
            newest(&releases, "0.6.1"),
            Some(json!({
                "version": "0.7.0",
                "url": "https://github.com/PavluntiyJ/ancient-lens/releases/tag/v0.7.0",
                "prerelease": true,
                "publishedAt": "2026-11-02T10:00:00Z",
            }))
        );
        assert_eq!(newest(&releases, "0.7.0"), None);
        assert_eq!(newest(&json!({"message": "Not Found"}), "0.6.1"), None);
        assert_eq!(newest(&json!([]), "0.6.1"), None);
    }
}
