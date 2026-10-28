//! Linux process access for the Source 2 reader: procfs and `process_vm_readv`, read-only.
//! Discovery in the ELF modules lives in `elf.rs`, the reading itself in `source2.rs`.
use super::elf;
pub(crate) use super::source2::Memory;
use super::source2::{
    resolve_classes, resource_service, Layout, Platform, Result, Session, Target, BAD,
};
use std::{collections::BTreeMap, fs, os::unix::fs::MetadataExt, path::PathBuf};

pub(crate) struct Process {
    pub(crate) pid: i32,
    pub(crate) started: String,
}
impl Process {
    pub(crate) fn find() -> Result<Self> {
        let mut candidate = None;
        for entry in fs::read_dir("/proc").map_err(|_| "not-running")?.flatten() {
            let Some(pid) = entry
                .file_name()
                .to_str()
                .and_then(|s| s.parse::<i32>().ok())
            else {
                continue;
            };
            let Ok(exe) = fs::read_link(entry.path().join("exe")) else {
                continue;
            };
            if exe.file_name().and_then(|s| s.to_str()) != Some("dota2") {
                continue;
            };
            if candidate.replace(pid).is_some() {
                return Err("multiple-games");
            }
        }
        let pid = candidate.ok_or("not-running")?;
        Ok(Self {
            pid,
            started: Self::started(pid)?,
        })
    }
    pub(crate) fn started(pid: i32) -> Result<String> {
        let stat = fs::read_to_string(format!("/proc/{pid}/stat")).map_err(|_| "not-running")?;
        // comm may contain spaces and parentheses; field 22 is relative to its final ')'.
        stat.rsplit_once(')')
            .and_then(|(_, rest)| rest.split_whitespace().nth(19))
            .map(str::to_owned)
            .ok_or(BAD)
    }
    pub(crate) fn alive(&self) -> bool {
        Self::started(self.pid).is_ok_and(|s| s == self.started)
    }
}
impl Memory for Process {
    fn read(&self, address: u64, len: usize) -> Result<Vec<u8>> {
        if len == 0
            || len > 1024 * 1024
            || address < 0x10000
            || address
                .checked_add(len as u64)
                .is_none_or(|end| end >= 0x800000000000)
        {
            return Err(BAD);
        }
        let mut bytes = vec![0u8; len];
        let local = libc::iovec {
            iov_base: bytes.as_mut_ptr().cast(),
            iov_len: len,
        };
        let remote = libc::iovec {
            iov_base: address as *mut libc::c_void,
            iov_len: len,
        };
        // SAFETY: local points to len initialized writable bytes. The remote address is
        // not dereferenced by Rust: the kernel validates it. This syscall only reads.
        let got = unsafe { libc::process_vm_readv(self.pid, &local, 1, &remote, 1, 0) };
        if got != len as isize {
            return Err(
                if got < 0
                    && matches!(
                        std::io::Error::last_os_error().raw_os_error(),
                        Some(libc::EPERM | libc::EACCES)
                    )
                {
                    "permission"
                } else {
                    "unavailable"
                },
            );
        }
        Ok(bytes)
    }
}

#[derive(Debug)]
pub(crate) struct Module {
    pub(crate) base: u64,
    pub(crate) path: PathBuf,
    pub(crate) inode: u64,
}
pub(crate) fn modules(pid: i32) -> Result<BTreeMap<String, Module>> {
    let maps = fs::read_to_string(format!("/proc/{pid}/maps")).map_err(|_| "not-running")?;
    let mut result = BTreeMap::new();
    for line in maps.lines() {
        // Paths can contain spaces, notably "dota 2 beta".
        let mut rest = line;
        let mut fields = vec![];
        for _ in 0..5 {
            rest = rest.trim_start();
            let n = rest.find(char::is_whitespace).unwrap_or(rest.len());
            fields.push(&rest[..n]);
            rest = &rest[n..];
        }
        if u64::from_str_radix(fields[2], 16).ok() != Some(0) || !fields[1].starts_with('r') {
            continue;
        }
        let path = PathBuf::from(rest.trim_start());
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !["libclient.so", "libengine2.so"].contains(&name) {
            continue;
        }
        let base =
            u64::from_str_radix(fields[0].split('-').next().ok_or(BAD)?, 16).map_err(|_| BAD)?;
        let inode = fields[4].parse().map_err(|_| BAD)?;
        result.insert(name.to_string(), Module { base, path, inode });
    }
    Ok(result)
}
pub(crate) fn module_file(module: &Module) -> Result<Vec<u8>> {
    let meta = fs::metadata(&module.path).map_err(|_| BAD)?;
    if meta.ino() != module.inode || meta.len() > 512 * 1024 * 1024 {
        return Err(BAD);
    }
    fs::read(&module.path).map_err(|_| BAD)
}

impl Target for Process {
    fn alive(&self) -> bool {
        Process::alive(self)
    }
}

pub(crate) struct Linux;
impl Platform for Linux {
    type Process = Process;
    fn connect() -> Result<Session<Process>> {
        let memory = Process::find()?;
        let modules = modules(memory.pid)?;
        let engine = modules.get("libengine2.so").ok_or(BAD)?;
        let client = modules.get("libclient.so").ok_or(BAD)?;
        let service = resource_service(
            &memory,
            engine.base + elf::create_interface(&module_file(engine)?)?,
        )?;
        let bytes = module_file(client)?;
        let candidates = elf::schema_candidates(&bytes)?
            .into_iter()
            .map(|(name, list)| (name, list.into_iter().map(|a| client.base + a).collect()))
            .collect();
        let classes = resolve_classes(&memory, candidates)?;
        let types = elf::entity_types(&bytes)?
            .rebased(client.base)
            .verified(|table| elf::type_name(&memory, table))?;
        let layout = Layout::new(&classes)?;
        // Observed Linux ABI: the resource service keeps its entity system at +0x50.
        Session::new(memory, service, layout, types, &[0x50])
    }
}
pub(super) type Provider = super::source2::Provider<Linux>;

#[cfg(test)]
mod tests {
    use super::super::Context;
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn reads_own_process_without_privileges_and_rejects_invalid_address() {
        let pid = std::process::id() as i32;
        let memory = Process {
            pid,
            started: Process::started(pid).unwrap(),
        };
        let value = [0x12u8, 0x34, 0x56, 0x78];
        assert_eq!(memory.read(value.as_ptr() as u64, 4).unwrap(), value);
        assert!(memory.read(0, 8).is_err());
        assert!(memory.read(u64::MAX - 2, 8).is_err());
    }

    /// Compare the native reader with an independently captured, token-free GSI
    /// spectator snapshot. This opt-in probe never starts Dota or changes game state.
    #[tokio::test]
    #[ignore = "requires a running observed match and ANCIENT_ROSTER_GSI"]
    async fn running_game_matches_gsi_roster() {
        let input = std::env::var("ANCIENT_ROSTER_GSI").unwrap();
        let mut raw: serde_json::Value = serde_json::from_slice(&fs::read(input).unwrap()).unwrap();
        raw["auth"] = serde_json::json!({"token":"diagnostic"});
        let mut normalized = crate::gsi::normalize(&raw, "diagnostic").unwrap();
        let expected = normalized["players"].as_array().unwrap().clone();
        assert_eq!(expected.len(), 10, "Reference must contain all ten players");
        let mut representative = expected[0].clone();
        representative["key"] = serde_json::json!("self");
        normalized["mode"] = serde_json::json!("player");
        normalized["players"] = serde_json::json!([representative]);
        let ctx = Context::from_gsi(&normalized).unwrap();
        let started = Instant::now();
        let mut session = Linux::connect().expect("Native interface/schema discovery failed");
        println!(
            "Native interface/schema resolved in {:?}",
            started.elapsed()
        );
        let started = Instant::now();
        let snapshot = session.poll(&ctx).expect("Native roster read failed");
        for row in &snapshot.players {
            let found = expected
                .iter()
                .find(|p| p["accountId"].as_str() == Some(&row.account_id.to_string()))
                .expect("Native player not present in reference GSI");
            assert_eq!(
                found["heroId"].as_u64(),
                Some(row.hero as u64),
                "Hero mismatch"
            );
            assert_eq!(
                found["team"].as_str(),
                Some(if row.team == 2 { "radiant" } else { "dire" }),
                "Team mismatch"
            );
        }
        println!(
            "Native roster: 10/10 identities, teams and heroes match GSI; two reads took {:?}",
            started.elapsed()
        );
        println!("Evidence applies to spectator process data, not a live player-mode match");
    }

    #[tokio::test]
    #[ignore = "requires a running observed match and ANCIENT_ROSTER_GSI"]
    async fn running_game_enriches_player_gsi() {
        let input = std::env::var("ANCIENT_ROSTER_GSI").unwrap();
        let mut raw: serde_json::Value = serde_json::from_slice(&fs::read(input).unwrap()).unwrap();
        raw["auth"] = serde_json::json!({"token":"diagnostic"});
        let mut normalized = crate::gsi::normalize(&raw, "diagnostic").unwrap();
        assert_eq!(normalized["players"].as_array().unwrap().len(), 10);
        let mut representative = normalized["players"][0].clone();
        representative["key"] = serde_json::json!("self");
        normalized["mode"] = serde_json::json!("player");
        normalized["players"] = serde_json::json!([representative]);
        let ctx = Context::from_gsi(&normalized).unwrap();
        let live = std::sync::Arc::new(tokio::sync::RwLock::new(serde_json::Value::Null));
        let tx = crate::roster::start(live.clone(), std::sync::Arc::new(|_| {}));
        normalized["receivedAt"] = serde_json::json!(chrono::Utc::now().timestamp_millis());
        tx.send_replace(normalized.clone());
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if live.read().await["rosterStatus"] == "ready" {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await
        .expect("Production worker did not enrich a one-player GSI input");
        {
            let enriched = live.read().await;
            assert_eq!(enriched["players"].as_array().unwrap().len(), 10);
            assert_eq!(enriched["mode"], "player");
            assert_eq!(enriched["rosterSource"], "native");
            let local = enriched["players"]
                .as_array()
                .unwrap()
                .iter()
                .find(|p| p["key"] == "self")
                .unwrap();
            assert_eq!(local, &normalized["players"][0]);
        }
        let other_match = (ctx.match_id + 1).to_string();
        normalized["matchId"] = serde_json::json!(other_match);
        tx.send_replace(normalized.clone());
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if live.read().await["matchId"] == other_match {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await
        .expect("Worker failed to react to a different GSI match");
        assert_eq!(live.read().await["players"].as_array().unwrap().len(), 1);
        assert_eq!(live.read().await["rosterStatus"], "match-mismatch");
        drop(tx);
        println!("Production worker: 1-player input -> 10-player output; local stats retained; mismatched match rejected");
        println!("Evidence applies to spectator process data, not a live player-mode match");
    }
}
