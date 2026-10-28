use super::{confidence, fresh_self, layout_linux::Layout, measured, Observation, Sample, HOLD};
use crate::roster::linux::{module_file, modules, Memory, Process};
use std::{path::PathBuf, time::SystemTime};

type Result<T> = std::result::Result<T, &'static str>;

/// Steam starts Dota with the login name in its environment, and loginusers.vdf maps logins
/// to accounts. Unlike GSI, which carries no Steam ID in the main menu, this is fixed for the
/// process lifetime, so the rating can be bound as soon as Dota runs.
pub(crate) fn launch_account(pid: i32) -> Option<String> {
    let env = std::fs::read(format!("/proc/{pid}/environ")).ok()?;
    let var = |name: &str| {
        env.split(|b| *b == 0)
            .find_map(|e| e.strip_prefix(name.as_bytes())?.strip_prefix(b"="))
            .and_then(|v| std::str::from_utf8(v).ok())
            .filter(|v| !v.is_empty())
    };
    let login = var("SteamAppUser")?;
    // The Steam installation that launched this game, not whichever one is the default.
    let steam = var("STEAM_COMPAT_CLIENT_INSTALL_PATH")
        .map(PathBuf::from)
        .or_else(|| Some(dirs::home_dir()?.join(".steam/root")))?;
    let vdf = std::fs::read_to_string(steam.join("config/loginusers.vdf")).ok()?;
    let id = login_account(&vdf, login)?;
    steam
        .join("userdata")
        .join(&id)
        .join("config/localconfig.vdf")
        .is_file()
        .then_some(id)
}

/// Account ID of the single `users` entry whose AccountName is `login`.
fn login_account(vdf: &str, login: &str) -> Option<String> {
    enum Token {
        Open,
        Close,
        Text(String),
    }
    let mut tokens = vec![];
    let mut chars = vdf.chars();
    while let Some(c) = chars.next() {
        match c {
            '{' => tokens.push(Token::Open),
            '}' => tokens.push(Token::Close),
            '"' => {
                let mut text = String::new();
                loop {
                    match chars.next()? {
                        '"' => break,
                        '\\' => text.push(chars.next()?),
                        c => text.push(c),
                    }
                }
                tokens.push(Token::Text(text));
            }
            _ => {}
        }
    }
    let (mut path, mut key, mut found) = (Vec::<String>::new(), None, vec![]);
    for token in tokens {
        match token {
            Token::Text(text) => match key.take() {
                None => key = Some(text),
                Some(name) => {
                    if path.len() == 2
                        && path[0] == "users"
                        && name.eq_ignore_ascii_case("AccountName")
                        // Steam login names are case-insensitive.
                        && text.eq_ignore_ascii_case(login)
                    {
                        found.push(path[1].clone());
                    }
                }
            },
            Token::Open => path.push(key.take()?),
            Token::Close => {
                path.pop()?;
            }
        }
    }
    let [steam_id] = &found[..] else { return None };
    if !steam_id.parse::<u64>().is_ok_and(|v| v > STEAM_BASE) {
        return None;
    }
    crate::store::account_id(steam_id).ok()
}
const STEAM_BASE: u64 = 76561197960265728;

fn read_sample(memory: &impl Memory, base: u64, layout: &Layout, now_sec: i64) -> Result<Sample> {
    // The loaded module must be the file that was analysed.
    let getter = base
        .checked_add(layout.getter as u64)
        .ok_or("unsupported")?;
    if memory.read(getter, layout.prefix.len())? != layout.prefix {
        return Err("unsupported");
    }
    let root = base.checked_add(layout.root as u64).ok_or("unsupported")?;
    let clock_addr = base.checked_add(layout.clock as u64).ok_or("unsupported")?;
    let count = memory.i32(root + 0x10)?;
    if !(1..=64).contains(&count) {
        return Err("waiting");
    }
    let nodes = memory.u64(root + 0x18)?;
    let mut rating = None;
    let mut conduct = None;
    for i in 0..count as u64 {
        let node = nodes.checked_add(i * 0x20).ok_or("unsupported")?;
        let key = memory.i32(node + 0x10)?;
        if ![6, 101].contains(&key) {
            continue;
        }
        let indirect = memory.u64(node + 0x18)?;
        if indirect == 0 {
            continue;
        }
        let object = memory.u64(indirect)?;
        if object == 0 {
            continue;
        }
        let a = memory.i32(object + 0x1c)?;
        let b = memory.i32(object + 0x20)?;
        if key == 6 {
            if rating.is_some() || !(0..=20000).contains(&a) {
                return Err("unavailable");
            }
            let clock = memory.i32(clock_addr)?;
            // Fail closed when the game clock is unavailable or not a current Unix time.
            if (now_sec - clock as i64).abs() > 300 {
                return Err("waiting");
            }
            let timestamp = memory.i32(object + 0x28)?;
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
    if memory.i32(root + 0x10)? != count || memory.u64(root + 0x18)? != nodes {
        return Err("waiting");
    }
    let (mmr, conf) = rating.ok_or("waiting")?;
    let (behavior, communication) = conduct.ok_or("waiting")?;
    Ok((mmr, conf, behavior, communication))
}

#[derive(Default)]
pub struct Reader {
    binding: Option<Binding>,
    /// libclient.so path, modification time, inode and located layout (None: unsupported).
    build: Option<(PathBuf, SystemTime, u64, Option<Layout>)>,
    last: Option<Sample>,
    confirmed: Option<(Sample, std::time::Instant)>,
}
struct Binding {
    pid: i32,
    started: String,
    account: String,
    blocked: bool,
}
impl Reader {
    /// `launch` (the process's Steam login) is consulted only for an unbound process; fresh
    /// self GSI binds when it is unavailable and otherwise can only confirm or block.
    fn bind(
        &mut self,
        pid: i32,
        started: &str,
        launch: impl FnOnce() -> Option<String>,
        game_account: Option<String>,
    ) -> Result<String> {
        if self
            .binding
            .as_ref()
            .is_some_and(|b| b.pid != pid || b.started != started)
        {
            self.binding = None;
            self.forget();
        }
        if self.binding.is_none() {
            let Some(account) = launch().or_else(|| game_account.clone()) else {
                self.forget();
                return Err("waiting-account");
            };
            self.binding = Some(Binding {
                pid,
                started: started.into(),
                account,
                blocked: false,
            });
        }
        let binding = self.binding.as_mut().unwrap();
        if game_account.is_some_and(|v| v != binding.account) {
            binding.blocked = true;
        }
        let (blocked, account) = (binding.blocked, binding.account.clone());
        if blocked {
            self.forget();
            Err("account-mismatch")
        } else {
            Ok(account)
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
    fn finish(&mut self, mut observation: Observation, result: Result<Sample>) -> Observation {
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
    fn poll_bound(
        &mut self,
        pid: i32,
        started: &str,
        live: &serde_json::Value,
        launch: impl FnOnce() -> Option<String>,
        read: impl FnOnce(&mut Self) -> Result<Sample>,
    ) -> Observation {
        let game_account = fresh_self(live);
        let id = match self.bind(pid, started, launch, game_account.clone()) {
            Ok(id) => id,
            Err(status) => return Observation::unavailable(game_account, status, "steam"),
        };
        let observation = Observation::unavailable(Some(id), "waiting-game", "steam");
        let result = read(self);
        self.finish(observation, result)
    }
    /// `memory` is the user's consent: without it the game process, including its
    /// environment, is never opened.
    pub fn poll(&mut self, live: &serde_json::Value, memory: bool) -> Observation {
        if !memory {
            self.forget();
            // An unobserved process may have been replaced; bind again after consent.
            self.binding = None;
            return Observation::unavailable(fresh_self(live), "reader-off", "gsi");
        }
        let process = match Process::find() {
            Ok(p) => p,
            Err("not-running") => {
                self.forget();
                self.binding = None;
                return Observation::unavailable(fresh_self(live), "waiting-game", "gsi");
            }
            Err(status) => {
                self.forget();
                return Observation::unavailable(fresh_self(live), status, "gsi");
            }
        };
        let pid = process.pid;
        let started = process.started.clone();
        self.poll_bound(
            pid,
            &started,
            live,
            // The environment must belong to the process found above, not a reused PID.
            || launch_account(pid).filter(|_| process.alive()),
            |reader| {
                let sample = reader.read_process(&process)?;
                if !process.alive() {
                    return Err("unavailable");
                }
                Ok(sample)
            },
        )
    }
    fn read_process(&mut self, process: &Process) -> Result<Sample> {
        let mods = modules(process.pid)?;
        let client = mods.get("libclient.so").ok_or("waiting")?;
        let modified = std::fs::metadata(&client.path)
            .and_then(|m| m.modified())
            .map_err(|_| "unavailable")?;
        if self.build.as_ref().is_none_or(|(p, t, ino, _)| {
            p != &client.path || *t != modified || *ino != client.inode
        }) {
            // Located once per libclient.so build: code shape and constants, not fixed RVAs.
            let bytes = module_file(client)?;
            self.build = Some((
                client.path.clone(),
                modified,
                client.inode,
                super::layout_linux::locate(&bytes),
            ));
        }
        let layout = self
            .build
            .as_ref()
            .unwrap()
            .3
            .clone()
            .ok_or("unsupported")?;
        read_sample(
            process,
            client.base,
            &layout,
            chrono::Utc::now().timestamp(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::Cell;

    const BASE: u64 = 0x100000;
    const NOW: i64 = 1791973595;

    struct Fixture {
        bytes: Vec<u8>,
        reads: Cell<u32>,
        change_header: Cell<bool>,
    }
    impl Fixture {
        fn put(&mut self, at: usize, data: &[u8]) {
            self.bytes[at..at + data.len()].copy_from_slice(data);
        }
        fn q(&mut self, at: usize, value: u64) {
            self.put(at, &value.to_le_bytes());
        }
        fn i(&mut self, at: usize, value: i32) {
            self.put(at, &value.to_le_bytes());
        }
    }
    impl Memory for Fixture {
        fn read(&self, address: u64, len: usize) -> Result<Vec<u8>> {
            self.reads.set(self.reads.get() + 1);
            let offset = address
                .checked_sub(BASE)
                .and_then(|v| usize::try_from(v).ok())
                .ok_or("unsupported")?;
            let mut out = self
                .bytes
                .get(offset..offset + len)
                .map(|v| v.to_vec())
                .ok_or("unavailable")?;
            if self.change_header.get() && offset == 0x2010 && self.reads.get() > 2 {
                out.copy_from_slice(&3i32.to_le_bytes());
            }
            Ok(out)
        }
    }

    fn fixture() -> (Fixture, Layout) {
        let mut m = Fixture {
            bytes: vec![0; 0x10000],
            reads: Cell::new(0),
            change_header: Cell::new(false),
        };
        let prefix = *b"\x55\x48\x89\xe5\x41\x54\x53\x48\x8d\x5d\xd0\x48\x83\xec\x30\x48";
        let layout = Layout {
            getter: 0x1000,
            root: 0x2000,
            clock: 0x3000,
            prefix,
        };
        m.put(layout.getter, &prefix);
        m.i(layout.clock, NOW as i32);
        // Root collection: 2 nodes at BASE + 0x4000.
        m.i(layout.root + 0x10, 2);
        m.q(layout.root + 0x18, BASE + 0x4000);
        // Node 0: key 6 -> indirect 0x5000 -> object 0x6000.
        m.i(0x4000 + 0x10, 6);
        m.q(0x4000 + 0x18, BASE + 0x5000);
        m.q(0x5000, BASE + 0x6000);
        m.i(0x6000 + 0x1c, 6586);
        m.i(0x6000 + 0x20, 110);
        m.i(0x6000 + 0x28, 1790882905);
        // Node 1: key 101 -> indirect 0x5100 -> object 0x6100.
        m.i(0x4020 + 0x10, 101);
        m.q(0x4020 + 0x18, BASE + 0x5100);
        m.q(0x5100, BASE + 0x6100);
        m.i(0x6100 + 0x1c, 12000);
        m.i(0x6100 + 0x20, 11850);
        (m, layout)
    }

    fn player_gsi(id: &str) -> serde_json::Value {
        json!({
            "status": "connected",
            "mode": "player",
            "receivedAt": chrono::Utc::now().timestamp_millis(),
            "accountId": id
        })
    }

    #[test]
    fn confirms_after_two_polls_and_hides_mmr_while_calibrating() {
        let (mut m, layout) = fixture();
        let mut reader = Reader::default();
        let gsi = player_gsi("123");
        let first = reader.poll_bound(
            10,
            "100",
            &gsi,
            || None,
            |_| read_sample(&m, BASE, &layout, NOW),
        );
        assert_eq!(first.status, "confirming");
        assert_eq!(first.account_id.as_deref(), Some("123"));
        assert_eq!(first.mmr, None);
        assert_eq!(first.confidence, None);

        let second = reader.poll_bound(
            10,
            "100",
            &serde_json::Value::Null,
            || None,
            |_| read_sample(&m, BASE, &layout, NOW),
        );
        assert_eq!(second.status, "measured");
        assert_eq!(second.source, "dota-memory");
        assert_eq!(second.account_id.as_deref(), Some("123"));
        assert_eq!(second.mmr, Some(6586));
        assert_eq!(second.confidence, Some(60));
        assert_eq!(second.behavior_score, Some(12000));
        assert_eq!(second.communication_score, Some(11850));

        // Confidence < 30 (raw = 165 -> 18%) reports calibrating and hides MMR.
        m.i(0x6000 + 0x20, 165);
        m.i(0x6000 + 0x28, 0);
        let mut calibrating = Reader::default();
        let _ = calibrating.poll_bound(
            10,
            "100",
            &gsi,
            || None,
            |_| read_sample(&m, BASE, &layout, NOW),
        );
        let out = calibrating.poll_bound(
            10,
            "100",
            &gsi,
            || None,
            |_| read_sample(&m, BASE, &layout, NOW),
        );
        assert_eq!(out.status, "calibrating");
        assert_eq!(out.source, "dota-memory");
        assert_eq!(out.mmr, None);
        assert_eq!(out.confidence, Some(18));
        assert_eq!(out.behavior_score, Some(12000));
    }

    #[test]
    fn memory_off_never_opens_the_process_and_drops_the_binding() {
        let (m, layout) = fixture();
        let mut reader = Reader::default();
        let _ = reader.poll_bound(
            10,
            "100",
            &json!(null),
            || Some("123".into()),
            |_| read_sample(&m, BASE, &layout, NOW),
        );
        // With consent off, `poll` returns before looking for the process at all.
        let out = reader.poll(&json!(null), false);
        assert_eq!(out.status, "reader-off");
        assert_eq!(out.account_id, None);
        assert!(reader.binding.is_none());
        assert_eq!(
            reader.poll(&player_gsi("456"), false).account_id.as_deref(),
            Some("456")
        );
    }

    #[test]
    fn fails_closed_on_invalid_counts_nulls_ranges_duplicates_header_clock_and_prefix() {
        let (_, layout) = fixture();
        // Count 0 and > 64 -> waiting.
        for count in [0, -1, 65] {
            let (mut m, _) = fixture();
            m.i(layout.root + 0x10, count);
            assert_eq!(read_sample(&m, BASE, &layout, NOW), Err("waiting"));
        }
        // Null indirect or object pointer -> waiting.
        for zero_at in [0x4000 + 0x18, 0x5000, 0x4020 + 0x18, 0x5100] {
            let (mut m, _) = fixture();
            m.q(zero_at, 0);
            assert_eq!(read_sample(&m, BASE, &layout, NOW), Err("waiting"));
        }
        // Out-of-range MMR, raw confidence, timestamp, and conduct scores -> unavailable.
        for (at, bad) in [
            (0x6000 + 0x1c, -1),
            (0x6000 + 0x1c, 20001),
            (0x6000 + 0x20, -1),
            (0x6000 + 0x20, 3001),
            (0x6000 + 0x28, -1),
            (0x6100 + 0x1c, -1),
            (0x6100 + 0x1c, 12001),
            (0x6100 + 0x20, -1),
            (0x6100 + 0x20, 12001),
        ] {
            let (mut m, _) = fixture();
            m.i(at, bad);
            assert_eq!(read_sample(&m, BASE, &layout, NOW), Err("unavailable"));
        }
        // Duplicate key 6 -> unavailable.
        let (mut m, _) = fixture();
        m.i(0x4020 + 0x10, 6);
        assert_eq!(read_sample(&m, BASE, &layout, NOW), Err("unavailable"));
        // Header changed during the read -> waiting.
        let (m, _) = fixture();
        m.change_header.set(true);
        assert_eq!(read_sample(&m, BASE, &layout, NOW), Err("waiting"));
        // Clock far from now -> waiting.
        for clock in [0, (NOW - 301) as i32, (NOW + 301) as i32] {
            let (mut m, _) = fixture();
            m.i(layout.clock, clock);
            assert_eq!(read_sample(&m, BASE, &layout, NOW), Err("waiting"));
        }
        // Prefix mismatch -> unsupported.
        let (mut m, _) = fixture();
        m.bytes[layout.getter] ^= 0xff;
        assert_eq!(read_sample(&m, BASE, &layout, NOW), Err("unsupported"));
    }

    #[test]
    fn binding_tracks_gsi_identity_blocks_conflicts_rebinds_new_process_and_ignores_spectator() {
        let (m, layout) = fixture();
        let mut reader = Reader::default();
        // Main-menu / empty GSI and spectator GSI never bind or read memory.
        let spectator = json!({
            "status": "connected",
            "mode": "spectator",
            "receivedAt": chrono::Utc::now().timestamp_millis(),
            "accountId": "123"
        });
        for input in [&serde_json::Value::Null, &spectator] {
            let out = reader.poll_bound(
                10,
                "100",
                input,
                || None,
                |_| read_sample(&m, BASE, &layout, NOW),
            );
            assert_eq!(out.status, "waiting-account");
            assert_eq!(out.account_id, None);
            assert_eq!(m.reads.get(), 0);
        }
        // First participant GSI binds and keeps the binding when GSI is later absent.
        let _ = reader.poll_bound(
            10,
            "100",
            &player_gsi("123"),
            || None,
            |_| read_sample(&m, BASE, &layout, NOW),
        );
        let measured = reader.poll_bound(
            10,
            "100",
            &serde_json::Value::Null,
            || None,
            |_| read_sample(&m, BASE, &layout, NOW),
        );
        assert_eq!(measured.status, "measured");
        assert_eq!(measured.account_id.as_deref(), Some("123"));
        assert_eq!(measured.mmr, Some(6586));

        // Conflicting participant GSI on the same process blocks reading until restart.
        let reads_before = m.reads.get();
        let conflict = reader.poll_bound(
            10,
            "100",
            &player_gsi("456"),
            || None,
            |_| read_sample(&m, BASE, &layout, NOW),
        );
        assert_eq!(conflict.status, "account-mismatch");
        assert_eq!(conflict.mmr, None);
        assert_eq!(m.reads.get(), reads_before);
        let still_blocked = reader.poll_bound(
            10,
            "100",
            &player_gsi("123"),
            || None,
            |_| read_sample(&m, BASE, &layout, NOW),
        );
        assert_eq!(still_blocked.status, "account-mismatch");
        assert_eq!(m.reads.get(), reads_before);

        // New start time (same PID) or new PID rebinds cleanly.
        let rebound = reader.poll_bound(
            10,
            "200",
            &player_gsi("456"),
            || None,
            |_| read_sample(&m, BASE, &layout, NOW),
        );
        assert_eq!(rebound.status, "confirming");
        assert_eq!(rebound.account_id.as_deref(), Some("456"));
    }
    #[test]
    fn steam_launch_binds_in_the_main_menu_and_gsi_can_only_block_it() {
        let (m, layout) = fixture();
        let mut reader = Reader::default();
        let menu = &json!(null);
        let read = |_: &mut Reader| read_sample(&m, BASE, &layout, NOW);
        let _ = reader.poll_bound(10, "100", menu, || Some("123".into()), read);
        let out = reader.poll_bound(10, "100", menu, || panic!("bound already"), read);
        assert_eq!(
            (out.status.as_str(), out.account_id.as_deref()),
            ("measured", Some("123"))
        );
        let same = reader.poll_bound(10, "100", &player_gsi("123"), || None, read);
        assert_eq!(same.status, "measured");
        let other = reader.poll_bound(10, "100", &player_gsi("456"), || None, read);
        assert_eq!(other.status, "account-mismatch");
        // A launch account wins over GSI for a new process; disagreeing GSI then blocks it.
        let fresh = reader.poll_bound(11, "300", &player_gsi("456"), || Some("123".into()), read);
        assert_eq!(fresh.status, "account-mismatch");
    }

    #[test]
    fn login_names_map_to_exactly_one_account() {
        let vdf = r#""users"
{
	"76561198000000001"
	{
		"AccountName"		"First"
		"PersonaName"		"AccountName \"Second\""
		"MostRecent"		"1"
	}
	"76561198000000002"
	{
		"AccountName"		"second"
	}
}"#;
        assert_eq!(login_account(vdf, "first").as_deref(), Some("39734273"));
        assert_eq!(login_account(vdf, "SECOND").as_deref(), Some("39734274"));
        assert_eq!(login_account(vdf, "third"), None);
        let twice = vdf.replace("\"second\"", "\"first\"");
        assert_eq!(login_account(&twice, "first"), None);
        assert_eq!(
            login_account("\"users\" { \"1\" { \"AccountName\" \"first\" } }", "first"),
            None
        );
        assert_eq!(
            login_account(
                "\"users\" { \"76561198000000001\" { \"AccountName\" \"first",
                "first"
            ),
            None
        );
    }
}
