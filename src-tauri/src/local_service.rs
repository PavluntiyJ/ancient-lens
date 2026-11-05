//! Discover the personal statistics service even when the binary bypasses its launcher, and
//! connect it from the app: the token goes from the connect call to the secret store and the
//! service's environment, nowhere else.
use crate::store::Result;
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

pub const LOCAL_URL: &str = "http://127.0.0.1:8787";
/// How long a just-started service may take to answer before the window opens; a local
/// process is ready in well under a second, and a broken install must not hold the window.
const START_TIMEOUT: Duration = Duration::from_secs(2);
/// After Connect the player is waiting for a result, so a slow start still counts.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// The service this app started, so it can end with the app instead of outliving it.
static STARTED_SERVICE: std::sync::Mutex<Option<std::process::Child>> = std::sync::Mutex::new(None);
/// Set when the service in use is older than the app and could not be restarted here.
static STALE_NOTICE: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);
/// No console window for a background service, even when the app was started from a shell.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Stop the child started by this app. A service the user started separately is untouched.
pub fn stop() {
    if let Ok(mut slot) = STARTED_SERVICE.lock() {
        if let Some(mut child) = slot.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// True while the child this app started is still running.
fn owned() -> bool {
    STARTED_SERVICE
        .lock()
        .ok()
        .and_then(|mut slot| {
            slot.as_mut()
                .map(|child| matches!(child.try_wait(), Ok(None)))
        })
        .unwrap_or(false)
}

/// The service binary in an app folder: beside the portable or installed executable.
fn service_beside(directory: &Path) -> Option<PathBuf> {
    ["stats-service.exe", "stats-service"]
        .into_iter()
        .map(|name| directory.join(name))
        .find(|path| path.is_file())
}

/// The service next to the app or a caller-supplied path for tests.
fn service_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("ANCIENT_STATS_SERVICE").map(PathBuf::from) {
        return path.is_file().then_some(path);
    }
    service_beside(std::env::current_exe().ok()?.parent()?)
}

/// Start the service as a hidden child. The token is only in the child's environment, never
/// in its command line, and the child's output is discarded.
fn spawn(path: &Path, token: &str) -> Result<()> {
    let mut command = Command::new(path);
    command
        .env("STRATZ_API_TOKEN", token)
        .env("ANCIENT_SERVICE_BIND", "127.0.0.1:8787")
        .env("ANCIENT_UPSTREAM_HOURLY_BUDGET", "60")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(&mut command, CREATE_NO_WINDOW);
    match command.spawn() {
        Ok(child) => {
            eprintln!(
                "Statistics service: started {} (pid {})",
                path.display(),
                child.id()
            );
            if let Ok(mut slot) = STARTED_SERVICE.lock() {
                *slot = Some(child);
            }
            Ok(())
        }
        Err(error) => {
            eprintln!(
                "Statistics service: could not start {}: {error}",
                path.display()
            );
            Err("The statistics service could not be started.".into())
        }
    }
}

#[cfg(target_os = "linux")]
fn unit_installed() -> bool {
    dirs::config_dir().is_some_and(|path| {
        path.join("systemd/user/ancient-lens-stats.service")
            .is_file()
    })
}

/// `systemctl --user <action>` on the installed unit; the unit alone reads the keyring.
#[cfg(target_os = "linux")]
async fn systemctl(action: &str) -> bool {
    let mut command = tokio::process::Command::new("systemctl");
    command
        .args(["--user", action, "--no-block", "ancient-lens-stats.service"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    tokio::time::timeout(Duration::from_secs(2), command.status())
        .await
        .is_ok_and(|result| result.is_ok_and(|status| status.success()))
}

/// `systemctl --user is-active`: whether the running service belongs to the unit, so the app
/// restarts only a process systemd manages and never one started some other way.
#[cfg(target_os = "linux")]
async fn unit_active() -> bool {
    let mut command = tokio::process::Command::new("systemctl");
    command
        .args([
            "--user",
            "is-active",
            "--quiet",
            "ancient-lens-stats.service",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    tokio::time::timeout(Duration::from_secs(2), command.status())
        .await
        .is_ok_and(|result| result.is_ok_and(|status| status.success()))
}

/// A ready service and the version it reports; `None` when the field is missing or not a
/// plain version, as from services built before 0.8.1.
#[derive(Debug, PartialEq)]
struct Health {
    version: Option<(u64, u64, u64)>,
}

impl Health {
    /// Older than this app, or too old to say: new fields of the app would stay empty.
    fn stale(&self) -> bool {
        let app = crate::releases::version(env!("CARGO_PKG_VERSION"));
        self.version.is_none_or(|version| Some(version) < app)
    }
}

/// The player-facing note for a service that is older than the app and still in use.
fn stale_message(health: &Health) -> String {
    let running = health
        .version
        .map(crate::releases::format)
        .map_or("an older version".into(), |version| {
            format!("version {version}")
        });
    format!(
        "The statistics service on this computer runs {running}, older than Ancient Lens {}. Ancient Lens did not start it, so it was left running; restart it to load new fields such as professional names.",
        env!("CARGO_PKG_VERSION")
    )
}

/// Why the service in use is older than the app, if it is.
pub fn stale_notice() -> Option<String> {
    STALE_NOTICE.lock().ok()?.clone()
}

fn set_stale_notice(notice: Option<String>) {
    if let Some(notice) = &notice {
        eprintln!("Statistics service: {notice}");
    }
    if let Ok(mut slot) = STALE_NOTICE.lock() {
        *slot = notice;
    }
}

async fn ready(url: &str) -> bool {
    health(url).await.is_some()
}

async fn health(url: &str) -> Option<Health> {
    // Windows retries a refused loopback connection for about two seconds, and discovery
    // runs before the window opens; a running service accepts at once.
    let Ok(client) = reqwest::Client::builder()
        .connect_timeout(Duration::from_millis(100))
        .timeout(Duration::from_millis(600))
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .build()
    else {
        return None;
    };
    let response = client.get(format!("{url}/health")).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let data = crate::api::read_response(response).await.ok()?;
    (data["status"] == "ready" && data["protocol"] == 1).then(|| Health {
        version: data["version"].as_str().and_then(crate::releases::version),
    })
}

async fn wait_ready(timeout: Duration) -> bool {
    wait_for(timeout, |_| true).await
}

/// Until the service answers with a version at least the app's; a restarted unit's old
/// process may still answer for a moment.
#[cfg(target_os = "linux")]
async fn wait_current(timeout: Duration) -> bool {
    wait_for(timeout, |health| !health.stale()).await
}

async fn wait_for(timeout: Duration, accept: impl Fn(&Health) -> bool) -> bool {
    tokio::time::timeout(timeout, async {
        while !health(LOCAL_URL)
            .await
            .is_some_and(|health| accept(&health))
        {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .is_ok()
}

/// A running service older than the app: the unit restarts it with the new binary, any other
/// process is left alone and reported in Settings.
async fn refresh(health: &Health) {
    if !health.stale() {
        set_stale_notice(None);
        return;
    }
    #[cfg(target_os = "linux")]
    if unit_installed() && unit_active().await {
        eprintln!("Statistics service: restarting the older ancient-lens-stats unit");
        if systemctl("restart").await && wait_current(Duration::from_secs(5)).await {
            set_stale_notice(None);
            return;
        }
        set_stale_notice(Some(format!(
            "The ancient-lens-stats user service is older than Ancient Lens {} and still runs the old version after a restart. Rebuild or reinstall stats-service and check it with systemctl --user status ancient-lens-stats.",
            env!("CARGO_PKG_VERSION")
        )));
        return;
    }
    set_stale_notice(Some(stale_message(health)));
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
    // the 100 ms connect timeout (Windows), or nothing where a refusal is immediate. One
    // left from an older build is restarted when the unit owns it, otherwise reported.
    if let Some(health) = health(LOCAL_URL).await {
        refresh(&health).await;
        return Some(LOCAL_URL.into());
    }
    #[cfg(target_os = "linux")]
    if unit_installed() {
        if systemctl("start").await {
            wait_ready(Duration::from_secs(5)).await;
        }
        // Preserve configured-provider identity on startup failure: actual
        // requests report unavailability, rather than asking for a new token.
        return Some(LOCAL_URL.into());
    }
    // Otherwise, with a saved token and the binary beside the app, this app owns a hidden
    // child. It ends with the app (see `stop`), so repeated launches do not accumulate
    // services. The binary is checked first, so a build without it never opens the keyring.
    let path = service_path()?;
    let token = tokio::time::timeout(Duration::from_secs(10), crate::stratz_token::load())
        .await
        .ok()?
        .ok()??;
    spawn(&path, &token).ok()?;
    wait_ready(START_TIMEOUT).await;
    Some(LOCAL_URL.into())
}

/// How a new token reaches a service.
enum Route {
    /// Started outside the app (for example by the Python launcher); it keeps its own token.
    External,
    #[cfg(target_os = "linux")]
    Unit,
    Child(PathBuf),
}

/// Chosen before STRATZ is contacted, so a build without the service saves nothing.
async fn route() -> Result<Route> {
    if !owned() && ready(LOCAL_URL).await {
        return Ok(Route::External);
    }
    #[cfg(target_os = "linux")]
    if unit_installed() {
        return Ok(Route::Unit);
    }
    service_path().map(Route::Child).ok_or_else(|| {
        if cfg!(windows) {
            "stats-service.exe is missing from the Ancient Lens folder. Reinstall Ancient Lens from the latest release."
        } else {
            "stats-service is missing beside Ancient Lens. Reinstall the package, or build it from source; see docs/guide/stats-service.md."
        }
        .into()
    })
}

/// The result of Connect or Disconnect: what to tell the player, and the service to use now.
pub struct Outcome {
    pub message: String,
    pub service: Option<String>,
}

/// Check the token with STRATZ, save it in the system secret store and (re)start the
/// service with it. The token is dropped when this returns.
pub async fn connect(token: &str) -> Result<Outcome> {
    connect_at(crate::stratz_token::GRAPHQL, token).await
}

async fn connect_at(endpoint: &str, token: &str) -> Result<Outcome> {
    let token = crate::stratz_token::clean(token)?;
    let route = route().await?;
    crate::stratz_token::probe(endpoint, &token).await?;
    crate::stratz_token::save(&token).await?;
    let message = match route {
        Route::External => {
            if let Some(health) = health(LOCAL_URL).await {
                refresh(&health).await;
            }
            "Token saved. A statistics service started outside Ancient Lens is already running and keeps its own token; restart it to use the new one.".into()
        }
        #[cfg(target_os = "linux")]
        Route::Unit => {
            if !(systemctl("restart").await && wait_ready(CONNECT_TIMEOUT).await) {
                return Err("The token was saved, but the ancient-lens-stats user service did not start. Check it with systemctl --user status ancient-lens-stats.".into());
            }
            if let Some(health) = health(LOCAL_URL).await {
                refresh(&health).await;
            }
            "STRATZ connected.".into()
        }
        Route::Child(path) => {
            stop();
            spawn(&path, &token)?;
            if !wait_ready(CONNECT_TIMEOUT).await {
                stop();
                return Err("The token was saved, but the statistics service did not answer. Restart Ancient Lens; if it persists, make sure nothing else uses port 8787.".into());
            }
            set_stale_notice(None);
            "STRATZ connected.".into()
        }
    };
    Ok(Outcome {
        message,
        service: Some(LOCAL_URL.into()),
    })
}

/// Delete the saved token and stop the service this app controls.
pub async fn disconnect() -> Result<Outcome> {
    crate::stratz_token::delete().await?;
    stop();
    #[cfg(target_os = "linux")]
    if unit_installed() {
        systemctl("stop").await;
        // `--no-block` returns before the unit has stopped.
        let _ = tokio::time::timeout(CONNECT_TIMEOUT, async {
            while ready(LOCAL_URL).await {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        })
        .await;
    }
    set_stale_notice(None);
    if let Some(health) = health(LOCAL_URL).await {
        refresh(&health).await;
        return Ok(Outcome {
            message: "Token removed. A statistics service started outside Ancient Lens is still running; stop it to use OpenDota.".into(),
            service: Some(LOCAL_URL.into()),
        });
    }
    Ok(Outcome {
        message:
            "STRATZ disconnected and the saved token removed. Public OpenDota statistics are used."
                .into(),
        service: None,
    })
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
        assert!(!owned());
    }

    #[test]
    fn the_service_is_found_only_beside_the_app() {
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(service_beside(directory.path()), None);
        let name = if cfg!(windows) {
            "stats-service.exe"
        } else {
            "stats-service"
        };
        std::fs::write(directory.path().join(name), b"").unwrap();
        assert_eq!(
            service_beside(directory.path()),
            Some(directory.path().join(name))
        );
    }

    /// A malformed token is refused before anything else happens: no STRATZ request, no
    /// secret store access and no service start.
    #[tokio::test]
    async fn a_malformed_token_is_refused_first() {
        for token in ["", "  ", "two\nlines"] {
            let error = connect_at("http://127.0.0.1:9/unused", token)
                .await
                .err()
                .unwrap();
            assert!(error.contains("STRATZ token"), "{error}");
        }
    }

    /// Opt-in Windows check of the whole Connect flow against a fake STRATZ: the synthetic
    /// token replaces the real Credential Manager entry, so it runs only on a test machine
    /// without a personal token. It proves the save, the hidden child, its health and the
    /// Disconnect cleanup together.
    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "replaces the saved STRATZ token in Windows Credential Manager"]
    async fn connect_and_disconnect_with_a_synthetic_token() {
        let service = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/release/stats-service.exe");
        assert!(service.is_file(), "build stats-service first");
        assert!(
            !ready(LOCAL_URL).await,
            "stop the running statistics service first"
        );
        assert_eq!(
            crate::stratz_token::load().await.unwrap(),
            None,
            "a STRATZ token is already saved; use a test machine"
        );
        std::env::set_var("ANCIENT_STATS_SERVICE", &service);
        let router = axum::Router::new().route(
            "/graphql",
            axum::routing::post(|| async { r#"{"data":{"players":[{"steamAccountId":1}]}}"# }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/graphql", listener.local_addr().unwrap());
        let fake = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let token = "synthetic-connect-token-0000";
        let outcome = connect_at(&endpoint, &format!(" {token}\n")).await.unwrap();
        assert_eq!(outcome.message, "STRATZ connected.");
        assert_eq!(outcome.service.as_deref(), Some(LOCAL_URL));
        assert_eq!(
            crate::stratz_token::load().await.unwrap().as_deref(),
            Some(token)
        );
        assert!(owned() && ready(LOCAL_URL).await);
        // Connecting again replaces the running child instead of reporting a foreign one.
        connect_at(&endpoint, token).await.unwrap();
        assert!(owned());
        let outcome = disconnect().await.unwrap();
        assert_eq!(outcome.service, None);
        assert_eq!(crate::stratz_token::load().await.unwrap(), None);
        assert!(!owned());
        fake.abort();
    }

    #[tokio::test]
    async fn discovery_requires_the_service_protocol() {
        for (status, body, expected) in [
            (200, r#"{"status":"ready","protocol":1}"#, true),
            (
                200,
                r#"{"status":"ready","protocol":1,"version":"0.8.1"}"#,
                true,
            ),
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

    /// Serve `body` as `/health` on a free port and return its URL.
    async fn fake_health(body: &'static str) -> (String, tokio::task::JoinHandle<()>) {
        let router =
            axum::Router::new().route("/health", axum::routing::get(move || async move { body }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        (url, server)
    }

    #[tokio::test]
    async fn health_reads_the_service_version() {
        for (body, version) in [
            (r#"{"status":"ready","protocol":1}"#, None),
            (
                r#"{"status":"ready","protocol":1,"version":"0.8.1"}"#,
                Some((0, 8, 1)),
            ),
            (
                r#"{"status":"ready","protocol":1,"version":"v1.2.3"}"#,
                Some((1, 2, 3)),
            ),
            (r#"{"status":"ready","protocol":1,"version":"dev"}"#, None),
            (r#"{"status":"ready","protocol":1,"version":7}"#, None),
        ] {
            let (url, server) = fake_health(body).await;
            assert_eq!(health(&url).await, Some(Health { version }), "{body}");
            server.abort();
        }
    }

    #[test]
    fn only_a_service_older_than_the_app_is_stale() {
        let app = crate::releases::version(env!("CARGO_PKG_VERSION")).unwrap();
        let (major, minor, patch) = app;
        assert!(Health { version: None }.stale());
        assert!(!Health { version: Some(app) }.stale());
        assert!(!Health {
            version: Some((major, minor, patch + 1))
        }
        .stale());
        assert!(!Health {
            version: Some((major + 1, 0, 0))
        }
        .stale());
        if patch > 0 {
            assert!(Health {
                version: Some((major, minor, patch - 1))
            }
            .stale());
        }
        assert!(Health {
            version: Some((0, 7, 3))
        }
        .stale());
    }

    #[test]
    fn the_stale_message_names_both_versions_or_says_older() {
        let message = stale_message(&Health {
            version: Some((0, 7, 3)),
        });
        assert!(message.contains("version 0.7.3"), "{message}");
        assert!(message.contains(env!("CARGO_PKG_VERSION")), "{message}");
        assert!(message.contains("restart it"), "{message}");
        let message = stale_message(&Health { version: None });
        assert!(message.contains("an older version"), "{message}");
    }

    /// The service built from this source reports this app's version, so it is never stale.
    #[tokio::test]
    async fn the_service_reports_the_app_version() {
        let broker = crate::broker::Broker::new("test-secret".into(), 1).unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                crate::broker::router(broker)
                    .into_make_service_with_connect_info::<std::net::SocketAddr>(),
            )
            .await
            .unwrap();
        });
        let found = health(&url).await.unwrap();
        assert_eq!(
            found.version,
            crate::releases::version(env!("CARGO_PKG_VERSION"))
        );
        assert!(!found.stale());
        server.abort();
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
