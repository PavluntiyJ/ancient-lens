//! Public Steam identity, independent of a statistics provider's profile snapshot.
use crate::store::{account_id, now, Result};
use serde::Deserialize;
use serde_json::{json, Value};

pub const TTL: i64 = 15 * 60 * 1000;
pub const LIMIT: usize = 512 * 1024;

#[derive(Deserialize)]
struct Profile {
    #[serde(rename = "steamID64")]
    id: String,
    #[serde(rename = "steamID")]
    name: String,
    #[serde(rename = "avatarFull")]
    avatar: String,
}

fn avatar_url(value: &str) -> bool {
    reqwest::Url::parse(value).is_ok_and(|url| {
        url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && url.port().is_none()
            && matches!(
                url.host_str(),
                Some(
                    "avatars.steamstatic.com"
                        | "avatars.fastly.steamstatic.com"
                        | "avatars.akamai.steamstatic.com"
                        | "avatars.cloudflare.steamstatic.com"
                        | "avatars.steamcommunity.com"
                )
            )
    })
}

pub fn validate(value: &Value, id: &str) -> bool {
    value["avatar"].as_str().is_some_and(avatar_url) && identity(value, id)
}

/// A synthetic identity for isolated screenshots and demos. The avatar may also be empty:
/// the page then draws its own placeholder, so a capture loads nothing from Steam.
pub fn validate_fixture(value: &Value, id: &str) -> bool {
    value["avatar"]
        .as_str()
        .is_some_and(|avatar| avatar.is_empty() || avatar_url(avatar))
        && identity(value, id)
}

fn identity(value: &Value, id: &str) -> bool {
    value["accountId"] == id
        && value["source"] == "Steam Community"
        && value["name"]
            .as_str()
            .is_some_and(|name| !name.trim().is_empty() && name.len() <= 200)
        && value["fetchedAt"]
            .as_str()
            .is_some_and(|at| chrono::DateTime::parse_from_rfc3339(at).is_ok())
}

pub fn parse(xml: &str, input: &str) -> Result<Value> {
    let id = account_id(input)?;
    if xml.len() > LIMIT || xml.contains("<!DOCTYPE") || xml.contains("<!ENTITY") {
        return Err("Invalid Steam profile response".into());
    }
    let profile: Profile =
        quick_xml::de::from_str(xml).map_err(|_| "Steam profile identity is unavailable")?;
    if profile.id != (id.parse::<u64>().unwrap() + 76561197960265728).to_string() {
        return Err("Steam profile identity did not match the requested account".into());
    }
    let value = json!({"accountId":id,"name":profile.name.trim(),"avatar":profile.avatar,"source":"Steam Community","fetchedAt":now(),"stale":false});
    if !validate(&value, &id) {
        return Err("Invalid Steam profile identity".into());
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn xml() -> String {
        "<profile><steamID64>76561197960265851</steamID64><steamID><![CDATA[New name <3 & friends]]></steamID><avatarFull>https://avatars.steamstatic.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_full.jpg</avatarFull></profile>".into()
    }
    #[test]
    fn parses_current_identity_without_statistic_fields() {
        let value = parse(&xml(), "123").unwrap();
        assert_eq!(value["name"], "New name <3 & friends");
        assert_eq!(value["accountId"], "123");
        assert!(value.get("rank_tier").is_none());
    }
    #[test]
    fn only_isolated_fixtures_may_leave_the_avatar_empty() {
        let mut value = parse(&xml(), "123").unwrap();
        assert!(validate(&value, "123") && validate_fixture(&value, "123"));
        value["avatar"] = json!("");
        assert!(!validate(&value, "123"));
        assert!(validate_fixture(&value, "123"));
        value["avatar"] = json!("http://localhost/avatar.png");
        assert!(!validate_fixture(&value, "123"));
        value["avatar"] = json!("");
        value["name"] = json!(" ");
        assert!(!validate_fixture(&value, "123"));
    }
    #[test]
    fn rejects_other_accounts_missing_identity_and_untrusted_avatars() {
        assert!(parse(&xml(), "456").is_err());
        assert!(parse("<profile><error>Unavailable</error></profile>", "123").is_err());
        assert!(parse(
            &xml().replace("avatars.steamstatic.com", "example.com"),
            "123"
        )
        .is_err());
        assert!(parse(&format!("<!DOCTYPE profile>{}", xml()), "123").is_err());
        assert!(parse(&"x".repeat(LIMIT + 1), "123").is_err());
    }
}
