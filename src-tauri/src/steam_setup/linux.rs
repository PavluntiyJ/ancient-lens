use super::{vdf, Host};
use crate::store::Result;
use std::{
    fs,
    os::unix::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

const FLATPAK: &str = "/.var/app/com.valvesoftware.Steam/";

/// Processes of this user whose executable has exactly this file name.
fn pids(name: &str) -> Vec<i32> {
    fs::read_dir("/proc")
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let pid = entry.file_name().to_str()?.parse::<i32>().ok()?;
            let exe = fs::read_link(entry.path().join("exe")).ok()?;
            (exe.file_name()? == name).then_some(pid)
        })
        .collect()
}
fn game() -> Option<i32> {
    match pids("dota2")[..] {
        [pid] => Some(pid),
        _ => None,
    }
}
fn environment(pid: i32, name: &str) -> Option<String> {
    let env = fs::read(format!("/proc/{pid}/environ")).ok()?;
    env.split(|b| *b == 0)
        .find_map(|e| e.strip_prefix(name.as_bytes())?.strip_prefix(b"="))
        .and_then(|v| String::from_utf8(v.to_vec()).ok())
        .filter(|v| !v.is_empty())
}
fn wait_gone(name: &str, timeout: Duration) -> bool {
    let until = Instant::now() + timeout;
    loop {
        if pids(name).is_empty() {
            return true;
        }
        if Instant::now() >= until {
            return false;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}
fn terminate(name: &str, grace: Duration) -> bool {
    for pid in pids(name) {
        unsafe { libc::kill(pid, libc::SIGTERM) };
    }
    if wait_gone(name, grace) {
        return true;
    }
    for pid in pids(name) {
        unsafe { libc::kill(pid, libc::SIGKILL) };
    }
    wait_gone(name, Duration::from_secs(5))
}
/// The launcher that matches this installation: Flatpak, Snap, or the steam script.
fn steam_command(steam: &Path) -> Command {
    let root = steam.to_string_lossy();
    if root.contains(FLATPAK) {
        let mut command = Command::new("flatpak");
        command.args(["run", "com.valvesoftware.Steam"]);
        command
    } else if root.contains("/snap/steam/") {
        let mut command = Command::new("snap");
        command.args(["run", "steam"]);
        command
    } else if std::env::var_os("PATH")
        .is_some_and(|path| std::env::split_paths(&path).any(|dir| dir.join("steam").is_file()))
    {
        Command::new("steam")
    } else {
        Command::new(steam.join("steam.sh"))
    }
}
/// Variables this app sets for itself, which Steam and the game must not inherit.
fn own_variable(name: &std::ffi::OsStr) -> bool {
    let name = name.to_string_lossy();
    name.starts_with("ANCIENT_") || name == "WEBKIT_DISABLE_DMABUF_RENDERER"
}
/// Steam runs for longer than this app, so it gets its own systemd scope when one can be made.
/// Otherwise it would belong to the desktop's unit for Ancient Lens, and stopping that unit
/// would take Steam and the game with it.
fn launcher(command: Command, scoped: bool) -> Command {
    let mut launcher = if scoped {
        let mut scope = Command::new("systemd-run");
        scope
            .args([
                "--user",
                "--scope",
                "--quiet",
                "--collect",
                "--slice=app.slice",
            ])
            .arg("--description=Steam")
            .arg("--")
            .arg(command.get_program())
            .args(command.get_args());
        scope
    } else {
        command
    };
    for (name, _) in std::env::vars_os().filter(|(name, _)| own_variable(name)) {
        launcher.env_remove(name);
    }
    if std::env::var_os("APPIMAGE").is_some() {
        // Library paths of the AppImage, not of the system Steam expects.
        for name in [
            "LD_LIBRARY_PATH",
            "GDK_PIXBUF_MODULE_FILE",
            "GIO_EXTRA_MODULES",
            "GSETTINGS_SCHEMA_DIR",
            "GST_PLUGIN_SYSTEM_PATH",
            "GST_PLUGIN_SYSTEM_PATH_1_0",
            "GTK_DATA_PREFIX",
            "GTK_EXE_PREFIX",
            "GTK_IM_MODULE_FILE",
            "GTK_PATH",
            "PERLLIB",
            "PYTHONHOME",
            "PYTHONPATH",
            "QT_PLUGIN_PATH",
            "APPDIR",
            "APPIMAGE",
            "ARGV0",
            "OWD",
        ] {
            launcher.env_remove(name);
        }
    }
    launcher
}
fn systemd_user_session() -> bool {
    Path::new("/run/systemd/system").is_dir()
        && std::env::var_os("XDG_RUNTIME_DIR")
            .is_some_and(|dir| Path::new(&dir).join("bus").exists())
        && std::env::var_os("PATH").is_some_and(|path| {
            std::env::split_paths(&path).any(|dir| dir.join("systemd-run").is_file())
        })
}
fn spawn(command: Command) -> Result<()> {
    let mut child = launcher(command, systemd_user_session())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map_err(|e| format!("Could not start Steam: {e}"))?;
    std::thread::spawn(move || child.wait());
    Ok(())
}

pub struct Native;
impl Host for Native {
    fn steam_roots(&self) -> Vec<PathBuf> {
        let mut roots = vec![];
        // The installation that launched the running game comes first.
        if let Some(path) =
            game().and_then(|pid| environment(pid, "STEAM_COMPAT_CLIENT_INSTALL_PATH"))
        {
            roots.push(PathBuf::from(path));
        }
        if let Some(home) = dirs::home_dir() {
            for path in [
                ".steam/root",
                ".steam/steam",
                ".local/share/Steam",
                ".var/app/com.valvesoftware.Steam/.local/share/Steam",
                "snap/steam/common/.local/share/Steam",
            ] {
                roots.push(home.join(path));
            }
        }
        let mut unique = vec![];
        for root in roots.iter().filter_map(|root| fs::canonicalize(root).ok()) {
            if !unique.contains(&root) {
                unique.push(root);
            }
        }
        unique
    }
    fn account(&self, steam: &Path) -> Option<String> {
        game()
            .and_then(crate::own_account::launch_account)
            .or_else(|| {
                vdf::most_recent_account(
                    &fs::read_to_string(steam.join("config/loginusers.vdf")).ok()?,
                )
            })
    }
    fn steam_running(&self) -> bool {
        !pids("steam").is_empty()
    }
    fn game_running(&self) -> bool {
        !pids("dota2").is_empty()
    }
    fn game_flag(&self) -> Option<bool> {
        let command = fs::read(format!("/proc/{}/cmdline", game()?)).ok()?;
        Some(
            command
                .split(|b| *b == 0)
                .any(|arg| arg.eq_ignore_ascii_case(vdf::GSI_FLAG.as_bytes())),
        )
    }
    fn stop_game(&self) -> Result<()> {
        if terminate("dota2", Duration::from_secs(20)) {
            Ok(())
        } else {
            Err("Dota 2 did not close. Close it and try again.".into())
        }
    }
    fn stop_steam(&self, steam: &Path) -> Result<()> {
        let mut command = steam_command(steam);
        command.arg("-shutdown");
        spawn(command)?;
        if wait_gone("steam", Duration::from_secs(45))
            || terminate("steam", Duration::from_secs(10))
        {
            Ok(())
        } else {
            Err("Steam did not close. Exit Steam and try again.".into())
        }
    }
    fn start_steam(&self, steam: &Path, game: bool) -> Result<()> {
        let mut command = steam_command(steam);
        if game {
            command.args(["-applaunch", "570"]);
        }
        spawn(command)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steam_gets_its_own_scope_without_this_apps_variables() {
        let mut steam = Command::new("steam");
        steam.args(["-applaunch", "570"]);
        let scoped = launcher(steam, true);
        assert_eq!(scoped.get_program(), "systemd-run");
        let args: Vec<_> = scoped
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(args[..2], ["--user", "--scope"]);
        assert_eq!(args[args.len() - 4..], ["--", "steam", "-applaunch", "570"]);
        assert!(own_variable("ANCIENT_STATS_URL".as_ref()));
        assert!(own_variable("WEBKIT_DISABLE_DMABUF_RENDERER".as_ref()));
        assert!(!own_variable("PATH".as_ref()));
        // Whatever this test process has of our own variables is removed from Steam's.
        let removed: Vec<_> = scoped
            .get_envs()
            .filter(|(_, v)| v.is_none())
            .map(|(k, _)| k)
            .collect();
        for (name, _) in std::env::vars_os().filter(|(name, _)| own_variable(name)) {
            assert!(removed.contains(&name.as_os_str()));
        }
        let plain = launcher(Command::new("steam"), false);
        assert_eq!(plain.get_program(), "steam");
    }
}
