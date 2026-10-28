//! Windows process access for the Source 2 reader: `ReadProcessMemory` through a handle that
//! can only read and query, never write or run code. Discovery in the PE modules lives in
//! `pe.rs`, the reading itself in `source2.rs`.
use super::pe;
use super::source2::{
    resolve_classes, resource_service, Layout, Memory, Platform, Result, Session, Target, BAD,
};
use std::{
    collections::BTreeMap,
    fs,
    mem::{size_of, zeroed},
    path::PathBuf,
};
use windows_sys::Win32::{
    Foundation::{
        CloseHandle, GetLastError, ERROR_ACCESS_DENIED, FILETIME, HANDLE, INVALID_HANDLE_VALUE,
    },
    System::{
        Diagnostics::{
            Debug::ReadProcessMemory,
            ToolHelp::{
                CreateToolhelp32Snapshot, Module32FirstW, Module32NextW, MODULEENTRY32W,
                TH32CS_SNAPMODULE,
            },
        },
        Threading::{
            GetExitCodeProcess, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
            PROCESS_VM_READ,
        },
    },
};

/// `GetExitCodeProcess` while the process runs.
const STILL_ACTIVE: u32 = 259;

struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        // SAFETY: the handle was returned open by Windows and is closed exactly once.
        unsafe {
            CloseHandle(self.0);
        }
    }
}
// SAFETY: a process or snapshot handle is a kernel object reference usable from any thread.
unsafe impl Send for Handle {}

pub(crate) struct Process {
    handle: Handle,
    pid: u32,
    created: u64,
}
impl Process {
    fn find() -> Result<Self> {
        let mut found = crate::own_account::processes()
            .map_err(|_| "not-running")?
            .into_iter()
            .filter(|(_, exe)| exe.eq_ignore_ascii_case("dota2.exe"));
        let (pid, _) = found.next().ok_or("not-running")?;
        if found.next().is_some() {
            return Err("multiple-games");
        }
        // SAFETY: plain Win32 call; a null result is checked below.
        let handle =
            unsafe { OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return Err("permission");
        }
        let handle = Handle(handle);
        let created = created(&handle).ok_or("not-running")?;
        Ok(Self {
            handle,
            pid,
            created,
        })
    }
}
fn created(handle: &Handle) -> Option<u64> {
    // SAFETY: all four out-parameters point to valid FILETIMEs.
    let (mut created, mut exit, mut kernel, mut user): (FILETIME, FILETIME, FILETIME, FILETIME) =
        unsafe { zeroed() };
    let ok =
        unsafe { GetProcessTimes(handle.0, &mut created, &mut exit, &mut kernel, &mut user) } != 0;
    ok.then_some(((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64)
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
        let mut read = 0;
        // SAFETY: `bytes` has `len` writable bytes. The remote address is validated by the
        // kernel, and this handle has only read and query access.
        let ok = unsafe {
            ReadProcessMemory(
                self.handle.0,
                address as _,
                bytes.as_mut_ptr().cast(),
                len,
                &mut read,
            )
        } != 0;
        if !ok || read != len {
            // SAFETY: plain Win32 call reading this thread's last error.
            return Err(if !ok && unsafe { GetLastError() } == ERROR_ACCESS_DENIED {
                "permission"
            } else {
                "unavailable"
            });
        }
        Ok(bytes)
    }
}
impl Target for Process {
    fn alive(&self) -> bool {
        let mut code = 0;
        // SAFETY: `code` is a valid out-parameter for the open handle.
        let running =
            unsafe { GetExitCodeProcess(self.handle.0, &mut code) } != 0 && code == STILL_ACTIVE;
        // A reused PID cannot pass: the handle keeps this process object, and its start time
        // is compared as well.
        running && created(&self.handle) == Some(self.created)
    }
}

struct Module {
    base: u64,
    path: PathBuf,
}
fn modules(pid: u32) -> Result<BTreeMap<String, Module>> {
    // SAFETY: plain Win32 call; an invalid handle is checked below.
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPMODULE, pid) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err("unavailable");
    }
    let snapshot = Handle(snapshot);
    // SAFETY: MODULEENTRY32W is plain data; dwSize is set before the first call.
    let mut entry: MODULEENTRY32W = unsafe { zeroed() };
    entry.dwSize = size_of::<MODULEENTRY32W>() as u32;
    let wide = |s: &[u16]| {
        String::from_utf16_lossy(&s[..s.iter().position(|c| *c == 0).unwrap_or(s.len())])
    };
    let mut result = BTreeMap::new();
    let mut ok = unsafe { Module32FirstW(snapshot.0, &mut entry) };
    while ok != 0 {
        let name = wide(&entry.szModule).to_ascii_lowercase();
        if name == "client.dll" || name == "engine2.dll" {
            result.insert(
                name,
                Module {
                    base: entry.modBaseAddr as u64,
                    path: PathBuf::from(wide(&entry.szExePath)),
                },
            );
        }
        ok = unsafe { Module32NextW(snapshot.0, &mut entry) };
    }
    Ok(result)
}
/// The module's file, only if it is the one the game loaded: the PE timestamp and image size
/// in memory must match the file (the inode check of the Linux reader).
fn module_file(memory: &Process, module: &Module) -> Result<Vec<u8>> {
    let meta = fs::metadata(&module.path).map_err(|_| BAD)?;
    if meta.len() > 512 * 1024 * 1024 {
        return Err(BAD);
    }
    let bytes = fs::read(&module.path).map_err(|_| BAD)?;
    let identity = |header: &[u8]| -> Option<(u32, u32)> {
        let nt = u32::from_le_bytes(header.get(0x3c..0x40)?.try_into().ok()?) as usize;
        let at = |offset: usize| {
            header
                .get(nt + offset..nt + offset + 4)
                .map(|v| u32::from_le_bytes(v.try_into().unwrap()))
        };
        // Signature, then TimeDateStamp in the file header and SizeOfImage in the optional one.
        (at(0)? == 0x4550).then_some((at(8)?, at(0x50)?))
    };
    let loaded = memory.read(module.base, 0x1000)?;
    match (identity(&loaded), identity(&bytes)) {
        (Some(running), Some(file)) if running == file => Ok(bytes),
        _ => Err(BAD),
    }
}

pub(crate) struct Windows;
impl Platform for Windows {
    type Process = Process;
    fn connect() -> Result<Session<Process>> {
        let memory = Process::find()?;
        let modules = modules(memory.pid)?;
        let engine = modules.get("engine2.dll").ok_or(BAD)?;
        let client = modules.get("client.dll").ok_or(BAD)?;
        let service = resource_service(
            &memory,
            engine.base + pe::create_interface(&module_file(&memory, engine)?)?,
        )?;
        let bytes = module_file(&memory, client)?;
        let candidates = pe::schema_candidates(&bytes)?
            .into_iter()
            .map(|(name, list)| (name, list.into_iter().map(|a| client.base + a).collect()))
            .collect();
        let classes = resolve_classes(&memory, candidates)?;
        let types = pe::entity_types(&bytes)?
            .rebased(client.base)
            .verified(|table| pe::type_name(&memory, table))?;
        let layout = Layout::new(&classes)?;
        // engine2's setter stores the entity system at +0x58 on Windows (static, build 6969);
        // +0x50 as on Linux is the fallback. Only an offset whose entities validate is used.
        Session::new(memory, service, layout, types, &[0x58, 0x50])
    }
}
pub(super) type Provider = super::source2::Provider<Windows>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_own_process_and_rejects_invalid_addresses() {
        let pid = std::process::id();
        // SAFETY: plain Win32 call; the result is checked.
        let handle =
            unsafe { OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        assert!(!handle.is_null());
        let handle = Handle(handle);
        let created = created(&handle).unwrap();
        let memory = Process {
            handle,
            pid,
            created,
        };
        assert!(memory.alive());
        let value = [0x12u8, 0x34, 0x56, 0x78];
        assert_eq!(memory.read(value.as_ptr() as u64, 4).unwrap(), value);
        assert!(memory.read(0, 8).is_err());
        assert!(memory.read(u64::MAX - 2, 8).is_err());
        let own = modules(pid).unwrap();
        assert!(own.is_empty(), "the test binary loads no game modules");
    }
}
