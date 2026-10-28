//! Checks and repairs the Steam side of the game connection: Ancient Lens's GSI file in the Dota
//! folder and `-gamestateintegration` in Dota's launch options. Steam keeps launch options in
//! localconfig.vdf and rewrites that file when it exits, so they are only edited while Steam is
//! closed, after the user agreed to close it.
#[cfg(target_os = "linux")]
mod linux;
mod vdf;
#[cfg(windows)]
mod windows;
use crate::store::Result;
use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

pub const CONFIG_NAME: &str = "gamestate_integration_ancient_lens.cfg";
const BACKUP_SUFFIX: &str = ".ancient-lens-backup";

/// The processes and Steam installations of this computer; replaced by a fake in tests.
pub trait Host {
    /// Steam installations to look in, the most likely first.
    fn steam_roots(&self) -> Vec<PathBuf>;
    /// The account that launched the running game or last signed in to Steam, if known.
    fn account(&self, steam: &Path) -> Option<String>;
    fn steam_running(&self) -> bool;
    fn game_running(&self) -> bool;
    /// Whether the running game was started with the GSI flag; `None` when unknown.
    fn game_flag(&self) -> Option<bool>;
    fn stop_game(&self) -> Result<()>;
    fn stop_steam(&self, steam: &Path) -> Result<()>;
    fn start_steam(&self, steam: &Path, game: bool) -> Result<()>;
}

#[cfg(target_os = "linux")]
pub fn host() -> impl Host {
    linux::Native
}
#[cfg(windows)]
pub fn host() -> impl Host {
    windows::Native
}
#[cfg(not(any(target_os = "linux", windows)))]
pub fn host() -> impl Host {
    Unsupported
}
#[cfg(not(any(target_os = "linux", windows)))]
struct Unsupported;
#[cfg(not(any(target_os = "linux", windows)))]
impl Host for Unsupported {
    fn steam_roots(&self) -> Vec<PathBuf> {
        vec![]
    }
    fn account(&self, _: &Path) -> Option<String> {
        None
    }
    fn steam_running(&self) -> bool {
        false
    }
    fn game_running(&self) -> bool {
        false
    }
    fn game_flag(&self) -> Option<bool> {
        None
    }
    fn stop_game(&self) -> Result<()> {
        Err("Not supported on this platform".into())
    }
    fn stop_steam(&self, _: &Path) -> Result<()> {
        Err("Not supported on this platform".into())
    }
    fn start_steam(&self, _: &Path, _: bool) -> Result<()> {
        Err("Not supported on this platform".into())
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// `ready`, `repair` (something this module can fix), `restart-game` or `unavailable`.
    pub state: &'static str,
    pub steam_path: Option<String>,
    pub dota_path: Option<String>,
    /// `installed`, `missing`, `outdated` or `unknown`.
    pub config: &'static str,
    /// `present`, `missing` or `unknown`.
    pub launch_option: &'static str,
    /// Steam accounts whose launch options are checked and would be changed.
    pub accounts: usize,
    pub steam_running: bool,
    pub game_running: bool,
    pub game_flag: Option<bool>,
    pub detail: Option<String>,
}
impl Status {
    pub fn unavailable(detail: &str) -> Self {
        Self {
            state: "unavailable",
            steam_path: None,
            dota_path: None,
            config: "unknown",
            launch_option: "unknown",
            accounts: 0,
            steam_running: false,
            game_running: false,
            game_flag: None,
            detail: Some(detail.into()),
        }
    }
}

struct Install {
    steam: PathBuf,
    dota: PathBuf,
    configs: Vec<PathBuf>,
}

fn find_dota(steam: &Path) -> Option<PathBuf> {
    let mut libraries = vec![steam.to_path_buf()];
    if let Ok(text) = fs::read_to_string(steam.join("steamapps/libraryfolders.vdf")) {
        libraries.extend(
            vdf::libraries(&text)
                .unwrap_or_default()
                .into_iter()
                .map(PathBuf::from),
        );
    }
    libraries.into_iter().find_map(|library| {
        let apps = library.join("steamapps");
        let manifest = fs::read_to_string(apps.join("appmanifest_570.acf")).ok()?;
        let path = apps.join("common").join(vdf::install_dir(&manifest)?);
        path.join("game/dota").is_dir().then_some(path)
    })
}
pub fn config_path(dota: &Path) -> PathBuf {
    dota.join("game/dota/cfg/gamestate_integration")
        .join(CONFIG_NAME)
}
/// The known account's localconfig.vdf; without one, every account that has played Dota here,
/// or every account when none has.
fn account_configs(steam: &Path, account: Option<String>) -> Vec<PathBuf> {
    let file = |id: &str| {
        steam
            .join("userdata")
            .join(id)
            .join("config/localconfig.vdf")
    };
    if let Some(path) = account.map(|id| file(&id)).filter(|p| p.is_file()) {
        return vec![path];
    }
    let mut all: Vec<PathBuf> = fs::read_dir(steam.join("userdata"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            (name != "0" && name.bytes().all(|b| b.is_ascii_digit())).then(|| file(&name))
        })
        .filter(|path| path.is_file())
        .collect();
    all.sort();
    let with_dota: Vec<PathBuf> = all
        .iter()
        .filter(|path| {
            fs::read_to_string(path)
                .ok()
                .is_some_and(|text| matches!(vdf::launch_options(&text), Ok(Some(_))))
        })
        .cloned()
        .collect();
    if with_dota.is_empty() {
        all
    } else {
        with_dota
    }
}

fn locate(host: &impl Host) -> std::result::Result<Install, Status> {
    let roots: Vec<PathBuf> = host
        .steam_roots()
        .into_iter()
        .filter(|root| root.join("steamapps").is_dir() || root.join("userdata").is_dir())
        .collect();
    if roots.is_empty() {
        return Err(Status::unavailable("Steam was not found on this computer."));
    }
    let Some((steam, dota)) = roots
        .iter()
        .find_map(|root| Some((root.clone(), find_dota(root)?)))
    else {
        let mut status = Status::unavailable("Dota 2 was not found in the Steam libraries.");
        status.steam_path = Some(roots[0].to_string_lossy().into());
        return Err(status);
    };
    let configs = account_configs(&steam, host.account(&steam));
    Ok(Install {
        steam,
        dota,
        configs,
    })
}

fn inspect_install(host: &impl Host, config: &str) -> (Status, Option<Install>) {
    let install = match locate(host) {
        Ok(install) => install,
        Err(status) => return (status, None),
    };
    let mut detail = None;
    let config_state = match fs::read_to_string(config_path(&install.dota)) {
        Ok(text) if text.replace("\r\n", "\n").trim() == config.trim() => "installed",
        Ok(_) => "outdated",
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => "missing",
        Err(e) => {
            detail = Some(format!("Could not read the GSI configuration: {e}"));
            "unknown"
        }
    };
    let mut launch = if install.configs.is_empty() {
        detail.get_or_insert("No Steam account has signed in on this computer yet.".into());
        "unknown"
    } else {
        "present"
    };
    for path in &install.configs {
        match fs::read_to_string(path)
            .map_err(|e| e.to_string())
            .and_then(|text| vdf::launch_options(&text))
        {
            Ok(Some(options)) if vdf::has_flag(&options) => {}
            Ok(_) if launch != "unknown" => launch = "missing",
            Ok(_) => {}
            Err(e) => {
                detail.get_or_insert(format!(
                    "Could not read the Steam settings in {}: {e}",
                    path.display()
                ));
                launch = "unknown";
            }
        }
    }
    let game_running = host.game_running();
    let game_flag = game_running.then(|| host.game_flag()).flatten();
    let state = if config_state == "unknown" || launch == "unknown" {
        "unavailable"
    } else if config_state != "installed" || launch == "missing" {
        "repair"
    } else if game_flag == Some(false) {
        "restart-game"
    } else {
        "ready"
    };
    let status = Status {
        state,
        steam_path: Some(install.steam.to_string_lossy().into()),
        dota_path: Some(install.dota.to_string_lossy().into()),
        config: config_state,
        launch_option: launch,
        accounts: install.configs.len(),
        steam_running: host.steam_running(),
        game_running,
        game_flag,
        detail,
    };
    (status, Some(install))
}
pub fn inspect(host: &impl Host, config: &str) -> Status {
    inspect_install(host, config).0
}

/// Writes `content` next to `path` and renames it into place, keeping the old file's mode.
fn replace(path: &Path, content: &str) -> Result<()> {
    let dir = path.parent().ok_or("Invalid path")?;
    fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let mut temp = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    temp.write_all(content.as_bytes())
        .map_err(|e| e.to_string())?;
    if let Ok(metadata) = fs::metadata(path) {
        let _ = fs::set_permissions(temp.path(), metadata.permissions());
    }
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(())
}
/// Appends the flag in each file that lacks it, after copying the file aside unchanged.
fn write_flags(configs: &[PathBuf]) -> Result<usize> {
    let mut written = 0;
    for path in configs {
        let text = fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let Some(updated) = vdf::with_gsi_flag(&text)? else {
            continue;
        };
        let mut backup = path.clone().into_os_string();
        backup.push(BACKUP_SUFFIX);
        fs::copy(path, &backup)
            .map_err(|e| format!("Could not back up {}: {e}", path.display()))?;
        replace(path, &updated)?;
        written += 1;
    }
    Ok(written)
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub installed_config: bool,
    /// Accounts whose launch options gained the flag.
    pub launch_options: usize,
    pub stopped_game: bool,
    pub restarted_steam: bool,
    pub launched_game: bool,
    /// The game kept running and has to be restarted to load the new configuration.
    pub restart_game: bool,
    pub status: Status,
}
/// Installs the GSI file and adds the launch option. Adding the option closes the game and
/// Steam first and starts Steam again afterwards; `launch_game` also starts Dota 2.
pub fn repair(host: &impl Host, config: &str, launch_game: bool) -> Result<Outcome> {
    let (status, install) = inspect_install(host, config);
    let install = match install {
        Some(install) if status.state != "unavailable" => install,
        _ => {
            return Err(status
                .detail
                .unwrap_or_else(|| "Steam settings cannot be changed.".into()))
        }
    };
    let mut outcome = Outcome {
        installed_config: false,
        launch_options: 0,
        stopped_game: false,
        restarted_steam: false,
        launched_game: false,
        restart_game: false,
        status: status.clone(),
    };
    if status.config != "installed" {
        replace(&config_path(&install.dota), config)?;
        outcome.installed_config = true;
    }
    if status.launch_option == "missing" {
        if host.game_running() {
            host.stop_game()?;
            outcome.stopped_game = true;
        }
        let steam_was_running = host.steam_running();
        if steam_was_running {
            host.stop_steam(&install.steam)?;
        }
        // Steam saves its settings on exit; editing them while it runs would be overwritten.
        let written = if host.steam_running() {
            Err("Steam is still running. Close Steam completely and try again.".into())
        } else {
            write_flags(&install.configs)
        };
        // Bring Steam back even when writing failed, as the user expects after closing it.
        if steam_was_running || launch_game {
            let started = host.start_steam(&install.steam, launch_game && written.is_ok());
            outcome.restarted_steam = steam_was_running && started.is_ok();
            outcome.launched_game = launch_game && written.is_ok() && started.is_ok();
            started.and(written.as_ref().map(|_| ()).map_err(Clone::clone))?;
        }
        outcome.launch_options = written?;
    } else if host.game_running() {
        outcome.restart_game = outcome.installed_config || status.state == "restart-game";
    } else if launch_game {
        host.start_steam(&install.steam, true)?;
        outcome.launched_game = true;
    }
    outcome.status = inspect(host, config);
    Ok(outcome)
}

/// Whether GSI reports the user playing a match, which closing the game would abandon.
pub fn in_match(live: &Value, now_ms: i64) -> bool {
    let fresh = live["receivedAt"]
        .as_i64()
        .is_some_and(|at| (0..30_000).contains(&(now_ms - at)));
    let state = live["gameState"].as_str().unwrap_or("");
    fresh
        && live["status"] == "connected"
        && live["mode"] == "player"
        && !state.is_empty()
        && ![
            "DOTA_GAMERULES_STATE_INIT",
            "DOTA_GAMERULES_STATE_POST_GAME",
            "DOTA_GAMERULES_STATE_DISCONNECT",
            "DOTA_GAMERULES_STATE_LAST",
        ]
        .contains(&state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::RefCell;

    const OPTIONS: &str = "\"UserLocalConfigStore\"\n{\n\t\"Software\"\n\t{\n\t\t\"Valve\"\n\t\t{\n\t\t\t\"Steam\"\n\t\t\t{\n\t\t\t\t\"apps\"\n\t\t\t\t{\n\t\t\t\t\t\"570\"\n\t\t\t\t\t{\n\t\t\t\t\t\t\"LaunchOptions\"\t\t\"OPTIONS\"\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n";

    #[derive(Default)]
    struct Fake {
        root: PathBuf,
        account: Option<String>,
        steam: RefCell<bool>,
        game: RefCell<bool>,
        flag: Option<bool>,
        stuck: bool,
        log: RefCell<Vec<String>>,
    }
    impl Host for Fake {
        fn steam_roots(&self) -> Vec<PathBuf> {
            vec![self.root.join("missing"), self.root.clone()]
        }
        fn account(&self, _: &Path) -> Option<String> {
            self.account.clone()
        }
        fn steam_running(&self) -> bool {
            *self.steam.borrow()
        }
        fn game_running(&self) -> bool {
            *self.game.borrow()
        }
        fn game_flag(&self) -> Option<bool> {
            self.flag
        }
        fn stop_game(&self) -> Result<()> {
            self.log.borrow_mut().push("stop game".into());
            *self.game.borrow_mut() = false;
            Ok(())
        }
        fn stop_steam(&self, _: &Path) -> Result<()> {
            // Steam saving its own copy on exit must not be what ends up on disk.
            self.log.borrow_mut().push("stop steam".into());
            *self.steam.borrow_mut() = self.stuck;
            Ok(())
        }
        fn start_steam(&self, _: &Path, game: bool) -> Result<()> {
            self.log
                .borrow_mut()
                .push(format!("start steam game={game}"));
            *self.steam.borrow_mut() = true;
            *self.game.borrow_mut() |= game;
            Ok(())
        }
    }

    fn setup(accounts: &[(&str, Option<&str>)]) -> (tempfile::TempDir, Fake) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Steam");
        let library = dir.path().join("Library");
        fs::create_dir_all(root.join("steamapps")).unwrap();
        fs::write(
            root.join("steamapps/libraryfolders.vdf"),
            format!(
                "\"libraryfolders\"\n{{\n\t\"0\"\n\t{{\n\t\t\"path\"\t\t\"{}\"\n\t}}\n\t\"1\"\n\t{{\n\t\t\"path\"\t\t\"{}\"\n\t}}\n}}\n",
                root.display().to_string().replace('\\', "\\\\"),
                library.display().to_string().replace('\\', "\\\\")
            ),
        )
        .unwrap();
        fs::create_dir_all(library.join("steamapps/common/dota 2 beta/game/dota")).unwrap();
        fs::write(
            library.join("steamapps/appmanifest_570.acf"),
            "\"AppState\"\n{\n\t\"installdir\"\t\t\"dota 2 beta\"\n}\n",
        )
        .unwrap();
        for (id, options) in accounts {
            let config = root.join("userdata").join(id).join("config");
            fs::create_dir_all(&config).unwrap();
            let text = match options {
                Some(options) => OPTIONS.replace("OPTIONS", options),
                None => "\"UserLocalConfigStore\"\n{\n\t\"Software\"\n\t{\n\t\t\"Valve\"\n\t\t{\n\t\t\t\"Steam\"\n\t\t\t{\n\t\t\t}\n\t\t}\n\t}\n}\n".into(),
            };
            fs::write(config.join("localconfig.vdf"), text).unwrap();
        }
        let fake = Fake {
            root,
            ..Fake::default()
        };
        (dir, fake)
    }
    fn options(fake: &Fake, id: &str) -> Option<String> {
        let path = fake
            .root
            .join("userdata")
            .join(id)
            .join("config/localconfig.vdf");
        vdf::launch_options(&fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn finds_dota_in_another_library_and_reports_what_is_missing() {
        let (dir, fake) = setup(&[("100", Some("-novid"))]);
        let status = inspect(&fake, "cfg");
        assert_eq!(status.state, "repair");
        assert_eq!(status.config, "missing");
        assert_eq!(status.launch_option, "missing");
        assert_eq!(status.accounts, 1);
        assert_eq!(
            status.dota_path.as_deref(),
            Some(
                &*dir
                    .path()
                    .join("Library")
                    .join("steamapps")
                    .join("common")
                    .join("dota 2 beta")
                    .to_string_lossy()
            )
        );

        let (_dir, mut fake) = setup(&[]);
        fs::remove_file(fake.root.join("steamapps/libraryfolders.vdf")).unwrap();
        assert_eq!(inspect(&fake, "cfg").state, "unavailable");
        fake.root = fake.root.join("nothing");
        let status = inspect(&fake, "cfg");
        assert_eq!(
            status.detail.as_deref(),
            Some("Steam was not found on this computer.")
        );
    }

    #[test]
    fn closes_game_and_steam_writes_the_flag_with_a_backup_and_restarts_steam() {
        let (dir, fake) = setup(&[("100", Some("-novid"))]);
        *fake.steam.borrow_mut() = true;
        *fake.game.borrow_mut() = true;
        let outcome = repair(&fake, "cfg\n", false).unwrap();
        assert!(outcome.installed_config && outcome.stopped_game && outcome.restarted_steam);
        assert_eq!(outcome.launch_options, 1);
        assert!(!outcome.launched_game);
        assert_eq!(
            *fake.log.borrow(),
            ["stop game", "stop steam", "start steam game=false"]
        );
        assert_eq!(
            options(&fake, "100").as_deref(),
            Some("-novid -gamestateintegration")
        );
        let backup = fake
            .root
            .join("userdata/100/config/localconfig.vdf.ancient-lens-backup");
        assert_eq!(
            fs::read_to_string(backup).unwrap(),
            OPTIONS.replace("OPTIONS", "-novid")
        );
        let cfg = dir
            .path()
            .join("Library/steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration")
            .join(CONFIG_NAME);
        assert_eq!(fs::read_to_string(cfg).unwrap(), "cfg\n");
        assert_eq!(outcome.status.state, "ready");
        // Nothing left to do: a second run changes nothing and closes nothing.
        let again = repair(&fake, "cfg\n", false).unwrap();
        assert!(!again.installed_config && again.launch_options == 0 && !again.restarted_steam);
        assert_eq!(fake.log.borrow().len(), 3);
    }

    #[test]
    fn steam_that_does_not_close_is_left_unedited_and_restarted() {
        let (_dir, mut fake) = setup(&[("100", Some(""))]);
        fake.stuck = true;
        *fake.steam.borrow_mut() = true;
        let error = repair(&fake, "cfg", true).unwrap_err();
        assert!(error.contains("Steam is still running"));
        assert_eq!(options(&fake, "100").as_deref(), Some(""));
        // The game is not launched without the flag, but Steam is started again.
        assert_eq!(fake.log.borrow().last().unwrap(), "start steam game=false");
    }

    #[test]
    fn known_account_alone_is_changed_otherwise_accounts_that_played_dota() {
        let (_dir, mut fake) = setup(&[("100", Some("")), ("200", Some("-x")), ("300", None)]);
        fake.account = Some("200".into());
        assert_eq!(inspect(&fake, "cfg").accounts, 1);
        repair(&fake, "cfg", false).unwrap();
        assert_eq!(options(&fake, "100").as_deref(), Some(""));
        assert_eq!(
            options(&fake, "200").as_deref(),
            Some("-x -gamestateintegration")
        );

        fake.account = Some("999".into());
        assert_eq!(inspect(&fake, "cfg").accounts, 2);
        repair(&fake, "cfg", false).unwrap();
        assert_eq!(
            options(&fake, "100").as_deref(),
            Some("-gamestateintegration")
        );
        assert_eq!(options(&fake, "300"), None);
    }

    #[test]
    fn only_the_config_is_written_while_the_game_keeps_running() {
        let (_dir, mut fake) = setup(&[("100", Some("-gamestateintegration"))]);
        fake.flag = Some(true);
        *fake.game.borrow_mut() = true;
        *fake.steam.borrow_mut() = true;
        let outcome = repair(&fake, "cfg", true).unwrap();
        assert!(outcome.installed_config && outcome.restart_game);
        assert!(!outcome.stopped_game && !outcome.launched_game);
        assert!(fake.log.borrow().is_empty());

        fake.flag = Some(false);
        assert_eq!(inspect(&fake, "cfg").state, "restart-game");
        *fake.game.borrow_mut() = false;
        let outcome = repair(&fake, "cfg", true).unwrap();
        assert!(outcome.launched_game);
        assert_eq!(*fake.log.borrow(), ["start steam game=true"]);
    }

    #[test]
    fn outdated_config_and_unreadable_settings() {
        let (dir, fake) = setup(&[("100", Some("-gamestateintegration"))]);
        let cfg = dir
            .path()
            .join("Library/steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration")
            .join(CONFIG_NAME);
        fs::create_dir_all(cfg.parent().unwrap()).unwrap();
        fs::write(&cfg, "old").unwrap();
        assert_eq!(inspect(&fake, "cfg").config, "outdated");
        fs::write(&cfg, "cfg\r\n").unwrap();
        assert_eq!(inspect(&fake, "cfg").state, "ready");

        fs::write(
            fake.root.join("userdata/100/config/localconfig.vdf"),
            "\"x\" {",
        )
        .unwrap();
        let status = inspect(&fake, "cfg");
        assert_eq!(status.state, "unavailable");
        assert!(status
            .detail
            .unwrap()
            .contains("Could not read the Steam settings"));
        assert!(repair(&fake, "cfg", false).is_err());
    }

    #[test]
    fn only_a_fresh_own_match_blocks_the_repair() {
        let now = 1_000_000;
        let live = json!({"status":"connected","mode":"player","receivedAt":now - 1000,"gameState":"DOTA_GAMERULES_STATE_GAME_IN_PROGRESS"});
        assert!(in_match(&live, now));
        assert!(in_match(
            &json!({"status":"connected","mode":"player","receivedAt":now,"gameState":"DOTA_GAMERULES_STATE_HERO_SELECTION"}),
            now
        ));
        for (key, value) in [
            ("mode", json!("spectator")),
            ("receivedAt", json!(now - 60_000)),
            ("gameState", json!("DOTA_GAMERULES_STATE_POST_GAME")),
            ("gameState", Value::Null),
            ("status", json!("waiting")),
        ] {
            let mut changed = live.clone();
            changed[key] = value;
            assert!(!in_match(&changed, now), "{key}");
        }
    }
}
