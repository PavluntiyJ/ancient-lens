use super::{confidence, fresh_self, layout::Layout, measured, Observation, Sample, HOLD};
use std::{
    mem::{size_of, zeroed},
    path::PathBuf,
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, FILETIME, HANDLE, INVALID_HANDLE_VALUE},
    System::{
        Diagnostics::{Debug::ReadProcessMemory, ToolHelp::*},
        Threading::{
            GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
        },
    },
};
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

type Result<T> = std::result::Result<T, &'static str>;

struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
impl Handle {
    fn snapshot(flags: u32, pid: u32) -> Result<Self> {
        let h = unsafe { CreateToolhelp32Snapshot(flags, pid) };
        if h == INVALID_HANDLE_VALUE {
            Err("unavailable")
        } else {
            Ok(Self(h))
        }
    }
    fn process(pid: u32) -> Result<Self> {
        let h = unsafe { OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if h.is_null() {
            Err("permission")
        } else {
            Ok(Self(h))
        }
    }
    fn read(&self, address: usize, n: usize) -> Result<Vec<u8>> {
        if address < 0x10000
            || n == 0
            || n > 4096
            || address.checked_add(n).is_none_or(|v| v >= 0x800000000000)
        {
            return Err("unsupported");
        }
        let mut b = vec![0; n];
        let mut read = 0;
        // Kernel validates remote addresses; this handle cannot write or execute code.
        if unsafe { ReadProcessMemory(self.0, address as _, b.as_mut_ptr().cast(), n, &mut read) }
            == 0
            || read != n
        {
            return Err("unavailable");
        }
        Ok(b)
    }
    fn u64(&self, a: usize) -> Result<usize> {
        Ok(u64::from_le_bytes(self.read(a, 8)?.try_into().unwrap()) as usize)
    }
    fn i32(&self, a: usize) -> Result<i32> {
        Ok(i32::from_le_bytes(self.read(a, 4)?.try_into().unwrap()))
    }
    fn created(&self) -> Result<u64> {
        let (mut created, mut exit, mut kernel, mut user): (
            FILETIME,
            FILETIME,
            FILETIME,
            FILETIME,
        ) = unsafe { zeroed() };
        if unsafe { GetProcessTimes(self.0, &mut created, &mut exit, &mut kernel, &mut user) } == 0
        {
            return Err("unavailable");
        }
        Ok(((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64)
    }
}
fn wide(s: &[u16]) -> String {
    String::from_utf16_lossy(&s[..s.iter().position(|c| *c == 0).unwrap_or(s.len())])
}

pub(crate) fn processes() -> Result<Vec<(u32, String)>> {
    let snapshot = Handle::snapshot(TH32CS_SNAPPROCESS, 0)?;
    let mut entry: PROCESSENTRY32W = unsafe { zeroed() };
    entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
    let mut ok = unsafe { Process32FirstW(snapshot.0, &mut entry) };
    let mut list = vec![];
    while ok != 0 {
        list.push((entry.th32ProcessID, wide(&entry.szExeFile)));
        ok = unsafe { Process32NextW(snapshot.0, &mut entry) };
    }
    Ok(list)
}
#[derive(Clone, PartialEq)]
struct SteamAccount {
    id: String,
    changed: u64,
    pid: u32,
}
fn steam_account(list: &[(u32, String)]) -> Option<SteamAccount> {
    let root = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Software\\Valve\\Steam")
        .ok()?;
    let active = root.open_subkey("ActiveProcess").ok()?;
    let metadata = active.query_info().ok()?;
    let changed = ((metadata.last_write_time.dwHighDateTime as u64) << 32)
        | metadata.last_write_time.dwLowDateTime as u64;
    let steam_pid: u32 = active.get_value("pid").ok()?;
    if !list
        .iter()
        .any(|(pid, name)| *pid == steam_pid && name.eq_ignore_ascii_case("steam.exe"))
    {
        return None;
    }
    let id: u32 = active.get_value("ActiveUser").ok()?;
    if id == 0 {
        return None;
    }
    let path: String = root.get_value("SteamPath").ok()?;
    PathBuf::from(path)
        .join("userdata")
        .join(id.to_string())
        .join("config/localconfig.vdf")
        .is_file()
        .then(|| SteamAccount {
            id: id.to_string(),
            changed,
            pid: steam_pid,
        })
}
fn client_module(pid: u32) -> Result<(usize, PathBuf)> {
    let snapshot = Handle::snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid)?;
    let mut entry: MODULEENTRY32W = unsafe { zeroed() };
    entry.dwSize = size_of::<MODULEENTRY32W>() as u32;
    let mut ok = unsafe { Module32FirstW(snapshot.0, &mut entry) };
    while ok != 0 {
        if wide(&entry.szModule).eq_ignore_ascii_case("client.dll") {
            return Ok((
                entry.modBaseAddr as usize,
                PathBuf::from(wide(&entry.szExePath)),
            ));
        }
        ok = unsafe { Module32NextW(snapshot.0, &mut entry) };
    }
    Err("waiting")
}

#[derive(Default)]
pub struct Reader {
    binding: Option<Binding>,
    /// client.dll path, its modification time and the layout located in it (None: unsupported).
    build: Option<(PathBuf, std::time::SystemTime, Option<Layout>)>,
    last: Option<Sample>,
    confirmed: Option<(Sample, std::time::Instant)>,
}
struct Binding {
    pid: u32,
    created: u64,
    account: String,
    blocked: bool,
}
impl Reader {
    fn bind(
        &mut self,
        pid: u32,
        created: u64,
        id: &str,
        game_account: Option<String>,
    ) -> Result<()> {
        if self
            .binding
            .as_ref()
            .is_none_or(|b| b.pid != pid || b.created != created)
        {
            self.binding = Some(Binding {
                pid,
                created,
                account: id.into(),
                blocked: false,
            });
            self.forget();
        }
        let binding = self.binding.as_mut().unwrap();
        if binding.account != id || game_account.is_some_and(|v| v != id) {
            binding.blocked = true;
        }
        if binding.blocked {
            Err("account-mismatch")
        } else {
            Ok(())
        }
    }
    fn forget(&mut self) {
        self.last = None;
        self.confirmed = None;
    }
    /// Keep showing the last confirmed rating while a changed sample is re-confirmed
    /// or the game briefly stops answering (map load), instead of blinking to "—".
    fn hold(&mut self, mut observation: Observation, status: &str) -> Observation {
        match self.confirmed {
            Some((sample, at)) if at.elapsed() < HOLD => measured(observation, sample),
            _ => {
                self.confirmed = None;
                observation.status = status.into();
                observation
            }
        }
    }
    /// `memory` is the user's consent: without it only the Steam registry is consulted.
    pub fn poll(&mut self, live: &serde_json::Value, memory: bool) -> Observation {
        let list = match processes() {
            Ok(l) => l,
            Err(status) => return Observation::unavailable(None, status, "steam"),
        };
        let account = steam_account(&list);
        let Some(session) = account else {
            self.forget();
            // A logout invalidates the binding even if a stale game remains alive.
            if let Some(binding) = &mut self.binding {
                binding.blocked = true;
            }
            return Observation::unavailable(None, "waiting-account", "steam");
        };
        let id = session.id.clone();
        let mut observation = Observation::unavailable(Some(id.clone()), "waiting-game", "steam");
        if !memory {
            self.forget();
            observation.status = "reader-off".into();
            return observation;
        }
        let games: Vec<_> = list
            .iter()
            .filter(|(_, name)| name.eq_ignore_ascii_case("dota2.exe"))
            .collect();
        if games.len() != 1 {
            self.forget();
            if games.is_empty() {
                self.binding = None;
            } else {
                observation.status = "multiple-games".into();
            }
            return observation;
        }
        let result = self.read(games[0].0, &session, live);
        // Reject a switch during the disk/memory read, including logout.
        if processes().ok().and_then(|l| steam_account(&l)).as_ref() != Some(&session) {
            self.forget();
            return Observation::unavailable(None, "switching", "steam");
        }
        match result {
            Ok(sample) if self.last == Some(sample) => {
                self.confirmed = Some((sample, std::time::Instant::now()));
                measured(observation, sample)
            }
            Ok(sample) => {
                self.last = Some(sample);
                self.hold(observation, "confirming")
            }
            // Transient: the same game and account, data momentarily unreadable.
            Err(status @ ("waiting" | "unavailable")) => {
                self.last = None;
                self.hold(observation, status)
            }
            Err(status) => {
                self.forget();
                observation.status = status.into();
                observation
            }
        }
    }
    fn read(
        &mut self,
        pid: u32,
        session: &SteamAccount,
        live: &serde_json::Value,
    ) -> Result<Sample> {
        let process = Handle::process(pid)?;
        let created = process.created()?;
        let id = session.id.as_str();
        let game_account = fresh_self(live);
        // Also detects switches before Ancient starts, and A→B→A between polls.
        // Never attach old game memory to a newer Steam login without a fresh self ID.
        if created < session.changed && game_account.as_deref() != Some(id) {
            return Err("account-mismatch");
        }
        self.bind(pid, created, id, game_account)?;
        let (base, path) = client_module(pid)?;
        let modified = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .map_err(|_| "unavailable")?;
        if self
            .build
            .as_ref()
            .is_none_or(|(p, t, _)| p != &path || *t != modified)
        {
            // Located once per client.dll build: code shape and constants, not fixed RVAs.
            let bytes = std::fs::read(&path).map_err(|_| "unavailable")?;
            self.build = Some((path, modified, super::layout::locate(&bytes)));
        }
        let layout = self
            .build
            .as_ref()
            .unwrap()
            .2
            .clone()
            .ok_or("unsupported")?;
        // The loaded module must be the file that was analysed.
        if process.read(base + layout.getter, layout.prefix.len())? != layout.prefix {
            return Err("unsupported");
        }
        let root = base + layout.root;
        let count = process.i32(root + 0x10)?;
        if !(1..=64).contains(&count) {
            return Err("waiting");
        }
        let nodes = process.u64(root + 0x18)?;
        let mut rating = None;
        let mut conduct = None;
        for i in 0..count as usize {
            let node = nodes.checked_add(i * 0x20).ok_or("unsupported")?;
            let key = process.i32(node + 0x10)?;
            if ![6, 101].contains(&key) {
                continue;
            }
            let indirect = process.u64(node + 0x18)?;
            if indirect == 0 {
                continue;
            }
            let object = process.u64(indirect)?;
            if object == 0 {
                continue;
            }
            let a = process.i32(object + 0x1c)?;
            let b = process.i32(object + 0x20)?;
            if key == 6 {
                if rating.is_some() || !(0..=20000).contains(&a) {
                    return Err("unavailable");
                }
                let clock = process.i32(base + layout.clock)?;
                // Fail closed when the game clock is unavailable or not a current Unix time.
                if (chrono::Utc::now().timestamp() - clock as i64).abs() > 300 {
                    return Err("waiting");
                }
                let timestamp = process.i32(object + 0x28)?;
                let conf = if a == 0 {
                    0
                } else {
                    confidence(b, timestamp, clock).ok_or("unavailable")?
                };
                rating = Some((a as u32, conf));
            } else {
                if conduct.is_some() || !(0..=12000).contains(&a) || !(0..=12000).contains(&b) {
                    return Err("unavailable");
                }
                conduct = Some((a as u32, b as u32));
            }
        }
        if process.i32(root + 0x10)? != count || process.u64(root + 0x18)? != nodes {
            return Err("waiting");
        }
        let (mmr, conf) = rating.ok_or("waiting")?;
        let (behavior, communication) = conduct.ok_or("waiting")?;
        Ok((mmr, conf, behavior, communication))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_game_cannot_be_relabelled_after_steam_switch() {
        let mut reader = Reader::default();
        assert!(reader.bind(1, 100, "123", None).is_ok());
        assert_eq!(reader.bind(1, 100, "456", None), Err("account-mismatch"));
        assert_eq!(reader.bind(1, 100, "123", None), Err("account-mismatch"));
        // Reused PID is a new process only when its creation time changes.
        assert!(reader.bind(1, 200, "456", None).is_ok());
        assert_eq!(
            reader.bind(1, 200, "456", Some("123".into())),
            Err("account-mismatch")
        );
        assert!(reader.bind(2, 300, "123", Some("123".into())).is_ok());
    }
    #[test]
    fn confirmed_rating_is_held_briefly_and_dropped_on_rebinding() {
        let waiting = || Observation::unavailable(Some("123".into()), "waiting-game", "steam");
        let mut reader = Reader::default();
        assert_eq!(reader.hold(waiting(), "confirming").status, "confirming");
        reader.confirmed = Some(((6586, 60, 12000, 12000), std::time::Instant::now()));
        let held = reader.hold(waiting(), "waiting");
        assert_eq!((held.status.as_str(), held.mmr), ("measured", Some(6586)));
        reader.confirmed = Some(((6586, 60, 12000, 12000), std::time::Instant::now() - HOLD));
        let expired = reader.hold(waiting(), "unavailable");
        assert_eq!(
            (expired.status.as_str(), expired.mmr),
            ("unavailable", None)
        );
        assert!(reader.confirmed.is_none());
        reader.confirmed = Some(((6586, 60, 12000, 12000), std::time::Instant::now()));
        assert!(reader.bind(1, 100, "123", None).is_ok());
        assert_eq!(reader.hold(waiting(), "confirming").mmr, None);
    }
}
