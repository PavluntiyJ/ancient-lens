use crate::store::{account_id, Result};

fn host(site: &str) -> Result<&'static str> {
    Ok(match site {
        "dotabuff" => "www.dotabuff.com",
        "opendota" => "www.opendota.com",
        "stratz" => "stratz.com",
        _ => return Err("Unknown site".into()),
    })
}
/// A player's page; Steam profiles are addressed by SteamID64, and Steam has no match pages.
pub fn url(input: &str, site: &str) -> Result<String> {
    let id = account_id(input)?;
    if site == "steam" {
        let id: u64 = id.parse().map_err(|_| "Invalid account")?;
        return Ok(format!(
            "https://steamcommunity.com/profiles/{}",
            76_561_197_960_265_728 + id
        ));
    }
    Ok(format!("https://{}/players/{id}", host(site)?))
}
pub fn match_url(id: &str, site: &str) -> Result<String> {
    let id = crate::match_details::match_id(id)?;
    Ok(format!("https://{}/matches/{id}", host(site)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_known_sites_and_valid_accounts() {
        assert_eq!(
            url("76561197960265729", "stratz").unwrap(),
            "https://stratz.com/players/1"
        );
        assert_eq!(
            url("1", "dotabuff").unwrap(),
            "https://www.dotabuff.com/players/1"
        );
        assert!(url("1", "https://example.org").is_err());
        assert!(url("1; touch /tmp/example", "opendota").is_err());
        assert!(url("0", "opendota").is_err());
        assert_eq!(
            url("123456789", "steam").unwrap(),
            "https://steamcommunity.com/profiles/76561198083722517"
        );
        assert!(match_url("8012345678", "steam").is_err());
        assert_eq!(
            match_url("8012345678", "dotabuff").unwrap(),
            "https://www.dotabuff.com/matches/8012345678"
        );
        for id in ["0", "-1", "1/../../x", "12345678901234"] {
            assert!(match_url(id, "stratz").is_err(), "{id}");
        }
        assert!(match_url("1", "example").is_err());
    }
}
