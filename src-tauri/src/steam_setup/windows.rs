use super::{vdf, Host};
use crate::store::Result;
use std::{
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::CloseHandle,
    System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE},
};
use winreg::{
    enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE},
    RegKey,
};

fn pids(name: &str) -> Vec<u32> {
    crate::own_account::processes()
        .unwrap_or_default()
        .into_iter()
        .filter(|(_, exe)| exe.eq_ignore_ascii_case(name))
        .map(|(pid, _)| pid)
        .collect()
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
fn terminate(name: &str) -> bool {
    for pid in pids(name) {
        unsafe {
            let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if !handle.is_null() {
                TerminateProcess(handle, 1);
                CloseHandle(handle);
            }
        }
    }
    wait_gone(name, Duration::from_secs(10))
}
fn steam_exe(steam: &Path) -> PathBuf {
    steam.join("steam.exe")
}

pub struct Native;
impl Host for Native {
    fn steam_roots(&self) -> Vec<PathBuf> {
        let user = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey("Software\\Valve\\Steam")
            .and_then(|key| key.get_value::<String, _>("SteamPath"));
        let machine = RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam")
            .and_then(|key| key.get_value::<String, _>("InstallPath"));
        let mut roots: Vec<PathBuf> = [user, machine]
            .into_iter()
            .flatten()
            .map(|path| PathBuf::from(path.replace('/', "\\")))
            .collect();
        roots.dedup_by(|a, b| a.as_os_str().eq_ignore_ascii_case(b.as_os_str()));
        roots
    }
    fn account(&self, steam: &Path) -> Option<String> {
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey("Software\\Valve\\Steam\\ActiveProcess")
            .and_then(|key| key.get_value::<u32, _>("ActiveUser"))
            .ok()
            .filter(|id| *id != 0)
            .map(|id| id.to_string())
            .or_else(|| {
                vdf::most_recent_account(
                    &std::fs::read_to_string(steam.join("config\\loginusers.vdf")).ok()?,
                )
            })
    }
    fn steam_running(&self) -> bool {
        !pids("steam.exe").is_empty()
    }
    fn game_running(&self) -> bool {
        !pids("dota2.exe").is_empty()
    }
    fn game_flag(&self) -> Option<bool> {
        // Reading another process's command line needs its memory; not worth it here.
        None
    }
    fn stop_game(&self) -> Result<()> {
        if terminate("dota2.exe") {
            Ok(())
        } else {
            Err("Dota 2 did not close. Close it and try again.".into())
        }
    }
    fn stop_steam(&self, steam: &Path) -> Result<()> {
        Command::new(steam_exe(steam))
            .arg("-shutdown")
            .spawn()
            .map_err(|e| format!("Could not ask Steam to close: {e}"))?;
        if wait_gone("steam.exe", Duration::from_secs(45)) || terminate("steam.exe") {
            Ok(())
        } else {
            Err("Steam did not close. Exit Steam and try again.".into())
        }
    }
    fn start_steam(&self, steam: &Path, game: bool) -> Result<()> {
        let mut command = Command::new(steam_exe(steam));
        if game {
            command.args(["-applaunch", "570"]);
        }
        command
            .spawn()
            .map_err(|e| format!("Could not start Steam: {e}"))?;
        Ok(())
    }
}
