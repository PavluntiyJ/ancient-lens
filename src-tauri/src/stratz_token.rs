//! The player's own STRATZ token: checked against STRATZ, kept in the system secret store and
//! handed only to the statistics service. It never enters app state, settings, exports or
//! logs, and no error message repeats it.
use crate::store::Result;
use std::time::Duration;

pub const GRAPHQL: &str = "https://api.stratz.com/graphql";
/// Where STRATZ issues tokens (My Tokens, after signing in with Steam).
pub const TOKENS_PAGE: &str = "https://stratz.com/api";
/// The public reference profile the Python launcher checks too; not the player's account.
const PROBE: &str = "{ players(steamAccountIds:[87278757]) { steamAccountId matchCount } }";
/// Matches `WINDOWS_TARGET` in scripts/stratz_credentials.py.
#[cfg_attr(not(windows), allow(dead_code))]
const WINDOWS_TARGET: &str = "Ancient Lens/STRATZ";
/// Matches `ATTRIBUTES` in scripts/stratz_credentials.py.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const LINUX_ATTRIBUTES: [&str; 4] = ["application", "org.ancientlens", "service", "stratz"];

/// The same rule as `valid_token` in the Python helper.
pub fn valid(token: &str) -> bool {
    !token.is_empty() && token.len() <= 4096 && !token.contains(['\r', '\n', '\0'])
}

/// A pasted token loses surrounding whitespace, as with the launcher's hidden prompt.
pub fn clean(token: &str) -> Result<String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("Paste your STRATZ token first.".into());
    }
    if !valid(token) {
        return Err(
            "This does not look like a STRATZ token. Copy it again from stratz.com/api.".into(),
        );
    }
    Ok(token.to_owned())
}

/// One player query against STRATZ, as `start-personal-stratz.py` does before saving.
pub async fn probe(endpoint: &str, token: &str) -> Result<()> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(25))
        .connect_timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not prepare the STRATZ check")?;
    let started = std::time::Instant::now();
    let sent = client
        .post(endpoint)
        .header("User-Agent", "STRATZ_API")
        .bearer_auth(token)
        .json(&serde_json::json!({ "query": PROBE }))
        .send()
        .await;
    let result = match sent {
        Err(_) => Err(
            "Could not reach STRATZ to check the token. Check the internet connection and try again."
                .to_string(),
        ),
        Ok(response) => match response.status().as_u16() {
            401 | 403 => Err(
                "STRATZ rejected this token. Copy your token again from stratz.com/api.".into(),
            ),
            429 => Err("STRATZ is limiting requests right now. Wait a minute and try again.".into()),
            status if !(200..300).contains(&status) => Err(format!(
                "STRATZ returned HTTP {status} while checking the token. Try again later."
            )),
            _ => match crate::api::read_response(response).await {
                Err(_) => Err("STRATZ sent an unexpected answer. Try again later.".into()),
                Ok(value) => {
                    let errors = value["errors"].as_array().is_some_and(|e| !e.is_empty());
                    let players = value["data"]["players"]
                        .as_array()
                        .is_some_and(|p| !p.is_empty());
                    if errors || !players {
                        Err("STRATZ did not grant this token access to player statistics. Check it at stratz.com/api.".into())
                    } else {
                        Ok(serde_json::Value::Null)
                    }
                }
            },
        },
    };
    crate::api::net_log("STRATZ token check", started, &result);
    result.map(|_| ())
}

/// Windows Credential Manager stores the token as UTF-16LE, like the Python helper.
#[cfg_attr(not(windows), allow(dead_code))]
fn to_blob(token: &str) -> Vec<u8> {
    token.encode_utf16().flat_map(u16::to_le_bytes).collect()
}
#[cfg_attr(not(windows), allow(dead_code))]
fn from_blob(bytes: &[u8]) -> Option<String> {
    if bytes.len() % 2 != 0 {
        return None;
    }
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    String::from_utf16(&units).ok()
}

/// A saved token that fails the format rule counts as broken, not as absent.
fn checked(token: Option<String>) -> Result<Option<String>> {
    match token {
        Some(token) if !valid(&token) => {
            Err("The saved STRATZ token is invalid. Connect STRATZ again.".into())
        }
        other => Ok(other),
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt};
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NOT_FOUND},
        Security::Credentials::{
            CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
            CRED_TYPE_GENERIC,
        },
    };

    fn wide(value: &str) -> Vec<u16> {
        OsStr::new(value).encode_wide().chain(Some(0)).collect()
    }

    pub fn save(target: &str, token: &str) -> Result<()> {
        let mut target = wide(target);
        let mut comment = wide("Ancient Lens statistics service");
        let mut user = wide("Ancient Lens");
        let mut blob = to_blob(token);
        let credential = CREDENTIALW {
            Flags: 0,
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_mut_ptr(),
            Comment: comment.as_mut_ptr(),
            LastWritten: unsafe { std::mem::zeroed() },
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            AttributeCount: 0,
            Attributes: std::ptr::null_mut(),
            TargetAlias: std::ptr::null_mut(),
            UserName: user.as_mut_ptr(),
        };
        // SAFETY: every pointer refers to a buffer that lives until the call returns.
        let written = unsafe { CredWriteW(&credential, 0) };
        blob.fill(0);
        if written == 0 {
            // SAFETY: reads the calling thread's last error only.
            let code = unsafe { GetLastError() };
            return Err(format!(
                "Could not save the token in Windows Credential Manager (error {code})."
            ));
        }
        Ok(())
    }

    pub fn load(target: &str) -> Result<Option<String>> {
        let target = wide(target);
        let mut credential: *mut CREDENTIALW = std::ptr::null_mut();
        // SAFETY: a valid UTF-16 target and an out-pointer owned by this function.
        let found = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) };
        if found == 0 || credential.is_null() {
            // SAFETY: reads the calling thread's last error only.
            return match unsafe { GetLastError() } {
                ERROR_NOT_FOUND => Ok(None),
                _ => Err("Windows Credential Manager is unavailable.".into()),
            };
        }
        // SAFETY: CredReadW returned a credential that stays valid until CredFree.
        let token = unsafe {
            let value = &*credential;
            from_blob(std::slice::from_raw_parts(
                value.CredentialBlob,
                value.CredentialBlobSize as usize,
            ))
        };
        // SAFETY: the pointer came from CredReadW and is freed exactly once.
        unsafe { CredFree(credential.cast()) };
        token
            .map(Some)
            .ok_or_else(|| "The saved STRATZ token is invalid. Connect STRATZ again.".into())
    }

    /// An absent entry is not an error.
    pub fn delete(target: &str) -> Result<()> {
        let target = wide(target);
        // SAFETY: a valid UTF-16 target.
        if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } == 0
            && unsafe { GetLastError() } != ERROR_NOT_FOUND
        {
            return Err("Could not remove the token from Windows Credential Manager.".into());
        }
        Ok(())
    }
}

/// The Secret Service through `secret-tool`, with the token on stdin, never in arguments.
#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use tokio::io::AsyncWriteExt;

    const UNAVAILABLE: &str =
        "Could not open the system keyring. Unlock it, make sure libsecret (secret-tool) is installed, and try again.";

    /// The keyring may show an unlock prompt; a person answers it, so wait as the helper does.
    async fn secret_tool(args: &[&str], input: Option<&str>) -> Result<std::process::Output> {
        let mut command = tokio::process::Command::new("secret-tool");
        command
            .args(args)
            .args(LINUX_ATTRIBUTES)
            .stdin(if input.is_some() {
                std::process::Stdio::piped()
            } else {
                std::process::Stdio::null()
            })
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        let run = async {
            let mut child = command.spawn().map_err(|_| UNAVAILABLE.to_string())?;
            if let (Some(input), Some(mut stdin)) = (input, child.stdin.take()) {
                stdin
                    .write_all(input.as_bytes())
                    .await
                    .map_err(|_| UNAVAILABLE.to_string())?;
            }
            child
                .wait_with_output()
                .await
                .map_err(|_| UNAVAILABLE.to_string())
        };
        tokio::time::timeout(Duration::from_secs(60), run)
            .await
            .map_err(|_| UNAVAILABLE.to_string())?
    }

    pub async fn save(token: &str) -> Result<()> {
        let output = secret_tool(&["store", "--label=Ancient Lens — STRATZ"], Some(token)).await?;
        if !output.status.success() {
            return Err(
                "Could not save the token: the system keyring is locked or unavailable. Unlock it and try again."
                    .into(),
            );
        }
        Ok(())
    }

    pub async fn load() -> Result<Option<String>> {
        let output = secret_tool(&["lookup"], None).await?;
        if !output.status.success() {
            if !output.stderr.iter().all(u8::is_ascii_whitespace) {
                return Err("The system keyring is unavailable or locked.".into());
            }
            return Ok(None);
        }
        let token = String::from_utf8(output.stdout)
            .map_err(|_| "The saved STRATZ token is invalid. Connect STRATZ again.")?;
        Ok(Some(token.trim_end_matches('\n').to_owned()))
    }

    pub async fn delete() -> Result<()> {
        // `clear` succeeds without a match; a failure here means the keyring itself is closed.
        let output = secret_tool(&["clear"], None).await?;
        if !output.status.success() {
            return Err(
                "Could not remove the token from the system keyring. Unlock it and try again."
                    .into(),
            );
        }
        Ok(())
    }
}

/// Saves the token and reads it back, so a keyring that silently drops writes is reported.
pub async fn save(token: &str) -> Result<()> {
    if !valid(token) {
        return Err("Invalid STRATZ token format.".into());
    }
    #[cfg(windows)]
    platform::save(WINDOWS_TARGET, token)?;
    #[cfg(target_os = "linux")]
    platform::save(token).await?;
    #[cfg(not(any(windows, target_os = "linux")))]
    return Err("This system has no supported secret store.".into());
    #[allow(unreachable_code)]
    if load().await?.as_deref() != Some(token) {
        return Err("Could not verify that the STRATZ token was saved.".into());
    }
    Ok(())
}

pub async fn load() -> Result<Option<String>> {
    #[cfg(windows)]
    return checked(platform::load(WINDOWS_TARGET)?);
    #[cfg(target_os = "linux")]
    return checked(platform::load().await?);
    #[cfg(not(any(windows, target_os = "linux")))]
    checked(None)
}

pub async fn delete() -> Result<()> {
    #[cfg(windows)]
    return platform::delete(WINDOWS_TARGET);
    #[cfg(target_os = "linux")]
    return platform::delete().await;
    #[cfg(not(any(windows, target_os = "linux")))]
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{http::HeaderMap, routing::post, Json, Router};
    use serde_json::{json, Value};

    /// Synthetic; never a real token.
    const TOKEN: &str = "synthetic-test-token-0000";

    #[test]
    fn pasted_tokens_are_trimmed_and_checked_like_the_launcher() {
        assert_eq!(clean("  abc.def \n").unwrap(), "abc.def");
        assert!(clean("   ").is_err());
        assert!(clean("first\nsecond").is_err());
        assert!(clean("nul\0inside").is_err());
        assert!(clean(&"a".repeat(4097)).is_err());
        assert!(clean(&"a".repeat(4096)).is_ok());
    }

    #[test]
    fn the_credential_blob_is_utf16_little_endian() {
        assert_eq!(to_blob("Ab"), vec![0x41, 0, 0x62, 0]);
        for token in [TOKEN, "grüße-🙂"] {
            assert_eq!(from_blob(&to_blob(token)).as_deref(), Some(token));
        }
        assert_eq!(from_blob(&[0x41]), None);
    }

    #[test]
    fn a_broken_saved_token_is_an_error_not_a_missing_one() {
        assert_eq!(checked(None).unwrap(), None);
        assert_eq!(checked(Some(TOKEN.into())).unwrap().as_deref(), Some(TOKEN));
        assert!(checked(Some("two\nlines".into())).is_err());
    }

    /// The Rust app and the Python launcher must find each other's saved token.
    #[test]
    fn storage_names_match_the_python_helper() {
        let helper = include_str!("../../scripts/stratz_credentials.py");
        assert!(helper.contains(&format!("WINDOWS_TARGET = '{WINDOWS_TARGET}'")));
        let attributes = LINUX_ATTRIBUTES
            .iter()
            .map(|value| format!("'{value}'"))
            .collect::<Vec<_>>()
            .join(", ");
        assert!(helper.contains(&format!("ATTRIBUTES = [{attributes}]")));
        assert!(include_str!("../../scripts/start-personal-stratz.py").contains(PROBE));
    }

    /// A fake STRATZ GraphQL endpoint that answers only the expected probe request.
    async fn fake(status: u16, body: &'static str) -> (String, tokio::task::JoinHandle<()>) {
        let router = Router::new().route(
            "/graphql",
            post(
                move |headers: HeaderMap, Json(request): Json<Value>| async move {
                    let authorized = headers["authorization"] == format!("Bearer {TOKEN}").as_str()
                        && headers["user-agent"] == "STRATZ_API"
                        && request == json!({ "query": PROBE });
                    if !authorized {
                        return (axum::http::StatusCode::BAD_REQUEST, "unexpected request");
                    }
                    (axum::http::StatusCode::from_u16(status).unwrap(), body)
                },
            ),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/graphql", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        (url, server)
    }

    #[tokio::test]
    async fn the_probe_accepts_only_a_token_with_player_access() {
        let accepted = r#"{"data":{"players":[{"steamAccountId":87278757,"matchCount":10}]}}"#;
        let (url, server) = fake(200, accepted).await;
        probe(&url, TOKEN).await.unwrap();
        server.abort();
        for (status, body, expected) in [
            (401, "", "rejected this token"),
            (403, "", "rejected this token"),
            (429, "", "limiting requests"),
            (500, "", "HTTP 500"),
            (400, "", "HTTP 400"),
            (200, "not json", "unexpected answer"),
            (
                200,
                r#"{"errors":[{"message":"denied"}],"data":{"players":[{"steamAccountId":1}]}}"#,
                "did not grant",
            ),
            (200, r#"{"data":{"players":[]}}"#, "did not grant"),
            (200, r#"{"data":null}"#, "did not grant"),
        ] {
            let (url, server) = fake(status, body).await;
            let error = probe(&url, TOKEN).await.unwrap_err();
            assert!(error.contains(expected), "{status} {body}: {error}");
            assert!(!error.contains(TOKEN));
            server.abort();
        }
    }

    #[tokio::test]
    async fn an_unreachable_stratz_is_a_network_error() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/graphql", listener.local_addr().unwrap());
        drop(listener);
        let error = probe(&url, TOKEN).await.unwrap_err();
        assert!(error.contains("Could not reach STRATZ"), "{error}");
    }

    /// Opt-in: writes, reads and deletes a synthetic entry under a separate test target.
    #[cfg(windows)]
    #[test]
    #[ignore = "writes a synthetic entry to Windows Credential Manager"]
    fn windows_credentials_round_trip() {
        let target = "Ancient Lens/STRATZ test";
        platform::delete(target).unwrap();
        assert_eq!(platform::load(target).unwrap(), None);
        platform::save(target, TOKEN).unwrap();
        assert_eq!(platform::load(target).unwrap().as_deref(), Some(TOKEN));
        platform::delete(target).unwrap();
        assert_eq!(platform::load(target).unwrap(), None);
        // Deleting what is already gone is not an error.
        platform::delete(target).unwrap();
    }
}
