//! Discover the personal statistics service even when the binary bypasses its launcher.
use std::time::Duration;

const LOCAL_URL: &str = "http://127.0.0.1:8787";
/// How long a just-started Windows service may take to answer; a local process is ready in
/// well under a second, and the window does not wait indefinitely on a broken install.
#[cfg(windows)]
const WINDOWS_START_TIMEOUT: Duration = Duration::from_secs(2);
/// The service this app started, so it can end with the app instead of outliving it.
#[cfg(windows)]
static STARTED_SERVICE: std::sync::Mutex<Option<std::process::Child>> = std::sync::Mutex::new(None);

/// Stop the child started by this app. A service the user started separately is untouched.
#[cfg(windows)]
pub fn stop() {
    if let Ok(mut slot) = STARTED_SERVICE.lock() {
        if let Some(mut child) = slot.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(not(windows))]
pub fn stop() {}

#[cfg(windows)]
mod windows_service {
    use std::{
        ffi::OsStr,
        os::windows::{ffi::OsStrExt, process::CommandExt},
        path::PathBuf,
        process::{Command, Stdio},
    };
    use windows_sys::Win32::Security::Credentials::{
        CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC,
    };

    /// Matches `WINDOWS_TARGET` in scripts/stratz_credentials.py.
    const TARGET: &str = "Ancient Lens/STRATZ";
    /// No console window for a background service, even when the app was started from a shell.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn wide(value: &str) -> Vec<u16> {
        OsStr::new(value).encode_wide().chain(Some(0)).collect()
    }

    /// The token saved by the Python launcher. It stays in this process and the child's
    /// environment; it is never logged, stored in state or sent to the page.
    pub(super) fn saved_token() -> Option<String> {
        let target = wide(TARGET);
        let mut credential: *mut CREDENTIALW = std::ptr::null_mut();
        // SAFETY: a valid UTF-16 target and an out-pointer owned by this function.
        let found = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) };
        if found == 0 || credential.is_null() {
            return None;
        }
        // SAFETY: CredReadW returned a credential that stays valid until CredFree.
        let token = unsafe {
            let value = &*credential;
            let bytes =
                std::slice::from_raw_parts(value.CredentialBlob, value.CredentialBlobSize as usize);
            let units: Vec<u16> = bytes
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .collect();
            String::from_utf16(&units).ok()
        };
        // SAFETY: the pointer came from CredReadW and is freed exactly once.
        unsafe { CredFree(credential.cast()) };
        token.filter(|token| {
            !token.is_empty() && token.len() <= 4096 && !token.contains(['\r', '\n', '\0'])
        })
    }

    /// The service next to the app (portable build) or a caller-supplied path for tests.
    fn service_path() -> Option<PathBuf> {
        if let Some(path) = std::env::var_os("ANCIENT_STATS_SERVICE").map(PathBuf::from) {
            return path.is_file().then_some(path);
        }
        let directory = std::env::current_exe().ok()?.parent()?.to_path_buf();
        ["stats-service.exe", "stats-service"]
            .into_iter()
            .map(|name| directory.join(name))
            .find(|path| path.is_file())
    }

    pub(super) fn start() -> Option<()> {
        let token = saved_token()?;
        let path = service_path()?;
        let mut command = Command::new(&path);
        command
            .env("STRATZ_API_TOKEN", token)
            .env("ANCIENT_SERVICE_BIND", "127.0.0.1:8787")
            .env("ANCIENT_UPSTREAM_HOURLY_BUDGET", "60")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW);
        match command.spawn() {
            Ok(child) => {
                eprintln!(
                    "Statistics service: started {} (pid {})",
                    path.display(),
                    child.id()
                );
                if let Ok(mut slot) = super::STARTED_SERVICE.lock() {
                    *slot = Some(child);
                }
                Some(())
            }
            Err(error) => {
                eprintln!(
                    "Statistics service: could not start {}: {error}",
                    path.display()
                );
                None
            }
        }
    }
}

async fn ready(url: &str) -> bool {
    // Windows retries a refused loopback connection for about two seconds, and discovery
    // runs before the window opens; a running service accepts at once.
    let Ok(client) = reqwest::Client::builder()
        .connect_timeout(Duration::from_millis(100))
        .timeout(Duration::from_millis(600))
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .build()
    else {
        return false;
    };
    let Ok(response) = client.get(format!("{url}/health")).send().await else {
        return false;
    };
    if !response.status().is_success() {
        return false;
    }
    let Ok(data) = crate::api::read_response(response).await else {
        return false;
    };
    data["status"] == "ready" && data["protocol"] == 1
}

pub async fn resolve(explicit: Option<String>, isolated: bool) -> Option<String> {
    // Explicit deployments and automated fixtures must never start or use the
    // user's personal service accidentally. An explicitly empty URL opts out.
    if explicit.is_some() {
        return explicit.filter(|url| !url.is_empty());
    }
    // Automated service tests opt in explicitly; ordinary fixtures still skip discovery.
    let test_autostart =
        isolated && cfg!(windows) && std::env::var_os("ANCIENT_TEST_STATS_SERVICE").is_some();
    if isolated && !test_autostart {
        return None;
    }
    // A service the user already started, on any system. Without one this costs at most
    // the 100 ms connect timeout (Windows), or nothing where a refusal is immediate.
    if ready(LOCAL_URL).await {
        return Some(LOCAL_URL.into());
    }
    // Windows has no installed unit; when a token is saved, this app owns a hidden child.
    // It ends with the app (see `stop`), so repeated launches do not accumulate services.
    #[cfg(windows)]
    {
        if windows_service::start().is_some() {
            let _ = tokio::time::timeout(WINDOWS_START_TIMEOUT, async {
                while !ready(LOCAL_URL).await {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            })
            .await;
            return Some(LOCAL_URL.into());
        }
    }
    // Only Linux has an installed service to start besides the Windows child above.
    #[cfg(target_os = "linux")]
    {
        let installed = dirs::config_dir().is_some_and(|path| {
            path.join("systemd/user/ancient-lens-stats.service")
                .is_file()
        });
        if installed {
            // The unit alone reads the keyring; credentials never enter the UI.
            let mut command = tokio::process::Command::new("systemctl");
            command
                .args([
                    "--user",
                    "start",
                    "--no-block",
                    "ancient-lens-stats.service",
                ])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .kill_on_drop(true);
            let started = tokio::time::timeout(Duration::from_secs(2), command.status())
                .await
                .is_ok_and(|result| result.is_ok_and(|status| status.success()));
            if started {
                let _ = tokio::time::timeout(Duration::from_secs(5), async {
                    while !ready(LOCAL_URL).await {
                        tokio::time::sleep(Duration::from_millis(100)).await;
                    }
                })
                .await;
            }
            // Preserve configured-provider identity on startup failure: actual
            // requests report unavailability, rather than asking for a new token.
            return Some(LOCAL_URL.into());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn explicit_and_isolated_launches_skip_personal_discovery() {
        assert_eq!(
            resolve(Some("https://stats.example".into()), false)
                .await
                .as_deref(),
            Some("https://stats.example")
        );
        assert_eq!(resolve(Some(String::new()), false).await, None);
        assert_eq!(resolve(None, true).await, None);
    }

    #[test]
    fn stopping_a_service_this_app_did_not_start_is_safe() {
        stop();
        stop();
    }

    /// Opt-in Windows check: requires `py -3` to have saved a synthetic token first. It
    /// proves the Rust Credential Manager read, the hidden child and its exit together.
    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "needs a synthetic token in Windows Credential Manager"]
    async fn a_saved_token_starts_and_stops_the_service() {
        let service = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/release/stats-service.exe");
        assert!(service.is_file(), "build stats-service first");
        std::env::set_var("ANCIENT_STATS_SERVICE", &service);
        assert!(
            windows_service::saved_token().is_some(),
            "save a synthetic token in Windows Credential Manager first"
        );
        assert!(windows_service::start().is_some());
        let mut up = false;
        for _ in 0..30 {
            if ready(LOCAL_URL).await {
                up = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert!(up, "the started service did not answer /health");
        stop();
        let mut down = false;
        for _ in 0..30 {
            if !ready(LOCAL_URL).await {
                down = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert!(down, "the service did not stop with the app");
    }

    #[tokio::test]
    async fn discovery_requires_the_service_protocol() {
        for (status, body, expected) in [
            (200, r#"{"status":"ready","protocol":1}"#, true),
            (200, r#"{"status":"ready","protocol":2}"#, false),
            (200, r#"{"status":"starting","protocol":1}"#, false),
            (200, "not json", false),
            (503, r#"{"status":"ready","protocol":1}"#, false),
        ] {
            let router = axum::Router::new().route(
                "/health",
                axum::routing::get(move || async move {
                    (axum::http::StatusCode::from_u16(status).unwrap(), body)
                }),
            );
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}", listener.local_addr().unwrap());
            let server = tokio::spawn(async move {
                axum::serve(listener, router).await.unwrap();
            });
            assert_eq!(ready(&url).await, expected);
            server.abort();
        }
    }

    #[tokio::test]
    async fn a_closed_port_is_refused_without_waiting_for_the_timeout() {
        // Discovery runs before the window opens on every system, Windows included.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        let started = std::time::Instant::now();
        assert!(!ready(&url).await);
        assert!(started.elapsed() < Duration::from_millis(300));
    }
}
