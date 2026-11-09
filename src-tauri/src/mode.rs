//! One immutable startup boundary for isolated automation. No game or personal data is
//! touched to discover the mode; API/GSI workers share the same snapshot as the desktop.
use std::{ffi::OsString, path::PathBuf, sync::OnceLock};

#[derive(Default)]
pub struct Mode {
    pub test_data: Option<PathBuf>,
    pub reader_prompt: bool,
    pub releases: Option<PathBuf>,
    pub account_feed: Option<PathBuf>,
    pub watch_foreground: bool,
    #[cfg(windows)]
    pub webview_debug_port: Option<u16>,
}

impl Mode {
    /// The only environment reader for isolated mode, called once at startup.
    fn read(mut env: impl FnMut(&str) -> Option<OsString>) -> Self {
        let test_data = env("ANCIENT_TEST_DATA").map(PathBuf::from);
        let isolated = test_data.is_some();
        Self {
            test_data,
            reader_prompt: !isolated || env("ANCIENT_READER_PROMPT").is_some_and(|v| v == "1"),
            releases: isolated
                .then(|| env("ANCIENT_TEST_RELEASES"))
                .flatten()
                .map(PathBuf::from),
            account_feed: isolated
                .then(|| env("ANCIENT_TEST_ACCOUNT_FEED"))
                .flatten()
                .map(PathBuf::from),
            watch_foreground: !isolated || env("ANCIENT_TEST_AUTO_HIDE").is_some_and(|v| v == "1"),
            #[cfg(windows)]
            webview_debug_port: isolated
                .then(|| env("ANCIENT_WEBVIEW_DEBUG_PORT"))
                .flatten()
                .and_then(|v| v.to_str()?.parse::<u16>().ok())
                .filter(|p| *p > 0),
        }
    }
    pub fn current() -> &'static Self {
        static MODE: OnceLock<Mode> = OnceLock::new();
        MODE.get_or_init(|| Self::read(|name| std::env::var_os(name)))
    }
    pub fn isolated(&self) -> bool {
        self.test_data.is_some()
    }
    pub fn data_directory(&self) -> PathBuf {
        self.test_data.clone().unwrap_or_else(|| {
            dirs::config_dir()
                .expect("User config directory")
                .join("Ancient Lens")
        })
    }
    /// Test commands are recognized only behind this gate, before their module is reached.
    pub fn test_command(&self, command: &str) -> bool {
        self.isolated() && matches!(command, "window:test-size" | "window:test-foreground")
    }
    #[cfg(feature = "desktop")]
    pub async fn open_external(&self, path: &str) -> crate::store::Result<()> {
        if !self.isolated() {
            crate::browser::open(path).await?;
        }
        Ok(())
    }
    pub fn require_secret_store(&self) -> crate::store::Result<()> {
        if self.isolated() {
            return Err("Connecting STRATZ is disabled in isolated test sessions.".into());
        }
        Ok(())
    }
    pub fn steam_status(
        &self,
        repair: bool,
    ) -> crate::store::Result<Option<crate::steam_setup::Status>> {
        if !self.isolated() {
            return Ok(None);
        }
        if repair {
            return Err("Steam setup is disabled in isolated test sessions.".into());
        }
        Ok(Some(crate::steam_setup::Status::unavailable(
            "Steam is not checked in isolated test sessions.",
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normal_mode_never_exposes_test_commands_or_fixtures() {
        let mode = Mode::read(|name| match name {
            "ANCIENT_TEST_RELEASES" | "ANCIENT_TEST_ACCOUNT_FEED" => Some("ignored".into()),
            _ => None,
        });
        assert!(!mode.test_command("window:test-size"));
        assert!(!mode.test_command("window:test-foreground"));
        assert!(mode.releases.is_none() && mode.account_feed.is_none());
        assert!(mode.reader_prompt && mode.watch_foreground);
        assert!(mode.require_secret_store().is_ok());
        assert!(mode.steam_status(false).unwrap().is_none());
    }
    #[test]
    fn isolated_mode_uses_only_explicit_fixture_overrides() {
        let mode = Mode::read(|name| match name {
            "ANCIENT_TEST_DATA" => Some("synthetic".into()),
            "ANCIENT_TEST_RELEASES" => Some("releases.json".into()),
            _ => None,
        });
        assert!(mode.test_command("window:test-size"));
        assert!(mode.test_command("window:test-foreground"));
        assert!(!mode.test_command("window:show"));
        assert_eq!(mode.data_directory(), PathBuf::from("synthetic"));
        assert_eq!(mode.releases, Some(PathBuf::from("releases.json")));
        assert!(!mode.reader_prompt && !mode.watch_foreground);
        assert!(mode.require_secret_store().is_err());
        assert!(mode.steam_status(true).is_err());
        assert!(mode.steam_status(false).unwrap().is_some());
    }
    #[test]
    fn isolated_prompts_and_foreground_watching_are_opt_in() {
        let mode = Mode::read(|name| match name {
            "ANCIENT_TEST_DATA" => Some("synthetic".into()),
            "ANCIENT_READER_PROMPT" | "ANCIENT_TEST_AUTO_HIDE" => Some("1".into()),
            _ => None,
        });
        assert!(mode.reader_prompt && mode.watch_foreground);
    }
}
