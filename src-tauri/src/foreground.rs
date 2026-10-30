//! Which application the user activates, so the windows over the game can step aside for any
//! other one. Only two things are read: which window became active, and the name of the
//! program its process runs. The game's process is opened for nothing more than that name
//! (`PROCESS_QUERY_LIMITED_INFORMATION` on Windows, the `/proc/<pid>/exe` link on Linux); its
//! memory is not read, nothing is sent to it, and its window is not touched.
//!
//! Windows: an out-of-context `EVENT_SYSTEM_FOREGROUND` hook, whose calls arrive through the
//! message loop of the thread that set it. Linux on X11: the window manager's
//! `_NET_ACTIVE_WINDOW` and the active window's `_NET_WM_PID`. Wayland tells an application
//! nothing about other applications' windows, so there is nothing to watch.

/// Whether the windows hide when the window of process `foreground_pid` becomes active.
/// `exe` is the path or file name of that process's program, `None` when it could not be read.
/// The app's own windows and the game keep them; any other program, or one that cannot be
/// named, hides them.
pub fn hide_for(foreground_pid: u32, own_pid: u32, exe: Option<&str>) -> bool {
    foreground_pid != own_pid && !exe.is_some_and(is_game)
}
/// Whether `exe`, a path or file name, is the game's program on either system.
pub fn is_game(exe: &str) -> bool {
    // Split by hand: a Windows path must name the same file when tests run on Linux.
    let name = exe.rsplit(['/', '\\']).next().unwrap_or(exe);
    ["dota2.exe", "dota2"]
        .iter()
        .any(|game| name.eq_ignore_ascii_case(game))
}

/// Whether this desktop reports the active window of other applications.
pub fn available() -> bool {
    cfg!(windows) || (cfg!(target_os = "linux") && !crate::overlay::wayland())
}

/// Calls `changed` with the process id and program of each newly active window; the program is
/// only looked up for other processes. Windows: call it on a thread with a message loop.
pub fn watch(changed: impl Fn(u32, Option<String>) + Send + Sync + 'static) -> Result<(), String> {
    if !available() {
        return Err("This desktop does not report the active window".into());
    }
    platform::watch(Box::new(changed))
}

type Changed = Box<dyn Fn(u32, Option<String>) + Send + Sync>;

#[cfg(windows)]
mod platform {
    use super::Changed;
    use std::sync::OnceLock;
    use windows_sys::Win32::{
        Foundation::{CloseHandle, HWND},
        System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
            PROCESS_QUERY_LIMITED_INFORMATION,
        },
        UI::{
            Accessibility::{SetWinEventHook, HWINEVENTHOOK},
            WindowsAndMessaging::{
                GetAncestor, GetWindowThreadProcessId, EVENT_SYSTEM_FOREGROUND, GA_ROOTOWNER,
                WINEVENT_OUTOFCONTEXT,
            },
        },
    };

    static CHANGED: OnceLock<Changed> = OnceLock::new();

    pub fn watch(changed: Changed) -> Result<(), String> {
        CHANGED
            .set(changed)
            .map_err(|_| "Already watching the active window")?;
        let hook = unsafe {
            SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                std::ptr::null_mut(),
                Some(foreground),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            )
        };
        // The hook lives as long as the app, so it is never removed.
        if hook.is_null() {
            Err("SetWinEventHook failed".into())
        } else {
            Ok(())
        }
    }
    unsafe extern "system" fn foreground(
        _: HWINEVENTHOOK,
        _: u32,
        hwnd: HWND,
        _: i32,
        _: i32,
        _: u32,
        _: u32,
    ) {
        let Some(changed) = CHANGED.get() else {
            return;
        };
        // A dialog or popup belongs to the program of the window that owns it.
        let owner = GetAncestor(hwnd, GA_ROOTOWNER);
        let mut pid = 0;
        GetWindowThreadProcessId(if owner.is_null() { hwnd } else { owner }, &mut pid);
        let exe = (pid != std::process::id()).then(|| program(pid)).flatten();
        changed(pid, exe);
    }
    /// The full path of the process's program; nothing else of the process is opened.
    fn program(pid: u32) -> Option<String> {
        unsafe {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if process.is_null() {
                return None;
            }
            let mut path = [0u16; 1024];
            let mut len = path.len() as u32;
            let read = QueryFullProcessImageNameW(
                process,
                PROCESS_NAME_WIN32,
                path.as_mut_ptr(),
                &mut len,
            );
            CloseHandle(process);
            (read != 0).then(|| String::from_utf16_lossy(&path[..len as usize]))
        }
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::Changed;
    use x11rb::{
        connection::Connection,
        protocol::{
            xproto::{AtomEnum, ChangeWindowAttributesAux, ConnectionExt, EventMask},
            Event,
        },
        rust_connection::RustConnection,
    };

    pub fn watch(changed: Changed) -> Result<(), String> {
        let (conn, screen) = x11rb::connect(None).map_err(|e| e.to_string())?;
        let root = conn.setup().roots[screen].root;
        let atom = |name: &str| -> Result<u32, String> {
            Ok(conn
                .intern_atom(false, name.as_bytes())
                .map_err(|e| e.to_string())?
                .reply()
                .map_err(|e| e.to_string())?
                .atom)
        };
        let active = atom("_NET_ACTIVE_WINDOW")?;
        let wm_pid = atom("_NET_WM_PID")?;
        conn.change_window_attributes(
            root,
            &ChangeWindowAttributesAux::new().event_mask(EventMask::PROPERTY_CHANGE),
        )
        .map_err(|e| e.to_string())?
        .check()
        .map_err(|e| e.to_string())?;
        std::thread::spawn(move || {
            let mut last = None;
            loop {
                let event = match conn.wait_for_event() {
                    Ok(event) => event,
                    Err(error) => {
                        eprintln!("Active window: {error}");
                        return;
                    }
                };
                let Event::PropertyNotify(event) = event else {
                    continue;
                };
                if event.window != root || event.atom != active {
                    continue;
                }
                // The window manager rewrites the property more often than it changes.
                let window = cardinal(&conn, root, active, AtomEnum::WINDOW.into());
                if window == last {
                    continue;
                }
                last = window;
                let pid = window
                    .filter(|&window| window != 0)
                    .and_then(|window| cardinal(&conn, window, wm_pid, AtomEnum::CARDINAL.into()))
                    .unwrap_or(0);
                let exe = (pid != 0 && pid != std::process::id())
                    .then(|| std::fs::read_link(format!("/proc/{pid}/exe")).ok())
                    .flatten()
                    .map(|path| path.to_string_lossy().into_owned());
                changed(pid, exe);
            }
        });
        Ok(())
    }
    /// The first 32-bit value of a window property.
    fn cardinal(conn: &RustConnection, window: u32, property: u32, kind: u32) -> Option<u32> {
        conn.get_property(false, window, property, kind, 0, 1)
            .ok()?
            .reply()
            .ok()?
            .value32()?
            .next()
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
mod platform {
    use super::Changed;

    pub fn watch(_: Changed) -> Result<(), String> {
        Err("This desktop does not report the active window".into())
    }
}

#[cfg(test)]
mod tests {
    use super::hide_for;

    #[test]
    fn own_windows_and_the_game_keep_the_overlay() {
        assert!(!hide_for(42, 42, None));
        assert!(!hide_for(
            42,
            42,
            Some("C:\\Program Files\\Ancient Lens\\ancient-lens.exe")
        ));
        for exe in [
            "C:\\Program Files (x86)\\Steam\\steamapps\\common\\dota 2 beta\\game\\bin\\win64\\dota2.exe",
            "DOTA2.EXE",
            "dota2.exe",
            "/home/user/.steam/steam/steamapps/common/dota 2 beta/game/bin/linuxsteamrt64/dota2",
            "Dota2",
        ] {
            assert!(!hide_for(7, 42, Some(exe)), "{exe}");
        }
    }
    #[test]
    fn any_other_or_unnamed_program_hides_it() {
        for exe in [
            "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
            "C:\\Windows\\explorer.exe",
            "/usr/bin/nautilus",
            "dota2.exe.bak",
            "C:\\Games\\dota2\\launcher.exe",
            "",
        ] {
            assert!(hide_for(7, 42, Some(exe)), "{exe}");
        }
        // No readable name, or no process at all (an X11 desktop with no active window).
        assert!(hide_for(7, 42, None));
        assert!(hide_for(0, 42, None));
    }
}
