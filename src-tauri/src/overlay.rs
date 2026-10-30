//! The match and profile windows stay above the game without taking the keyboard from it, so a
//! game that mutes itself in the background keeps its sound. Mouse clicks work as usual; a
//! window takes the keyboard only when the user clicks a text field or its keyboard button,
//! and gives up that right again when it loses the focus. These are ordinary windows of their
//! own: nothing here touches the game's window, process or input.
//!
//! Windows: the windows have `WS_EX_NOACTIVATE`, so clicking them leaves the game in front.
//! tao shows a window with `SW_SHOW`, which activates it even with that style, and its focus
//! call may press a synthetic Alt key, which would reach the game. So the windows are created
//! visible, tao keeps believing they are, and they are hidden and shown here with
//! `ShowWindow` directly. Calling tao's `show`/`hide`/`set_focus` on them would undo this.
//!
//! Linux on X11: GTK's accept-focus hint does the same, if the window manager honours it.
//! Wayland lets the compositor decide stacking and focus, so the windows behave as before:
//! showing one activates it, and the game goes to the background.
use tauri::{Runtime, Window};

/// Whether this desktop can show a window without activating it.
pub fn passive() -> bool {
    cfg!(windows) || (cfg!(target_os = "linux") && !wayland())
}
/// A native Wayland session. The app may still run through XWayland, as the launcher for
/// NVIDIA does; then GTK talks X11 and the hints work.
pub fn wayland() -> bool {
    std::env::var_os("WAYLAND_DISPLAY").is_some()
        && std::env::var("GDK_BACKEND").map_or(true, |backend| !backend.starts_with("x11"))
}
/// The window is up: visible and not minimized. Above the game too, since it stays on top,
/// except on Wayland, where only the focused window is known to be in front.
pub fn in_front<R: Runtime>(window: &Window<R>) -> bool {
    window.is_visible().unwrap_or(false)
        && !window.is_minimized().unwrap_or(false)
        && (passive() || window.is_focused().unwrap_or(false))
}

#[cfg(windows)]
mod platform {
    use tauri::{Runtime, Window};
    use windows_sys::Win32::{
        Foundation::HWND,
        UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetForegroundWindow, SetWindowLongPtrW, SetWindowPos, ShowWindow,
            GWL_EXSTYLE, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_HIDE,
            SW_SHOWMINNOACTIVE, SW_SHOWNOACTIVATE, WS_EX_NOACTIVATE,
        },
    };

    /// Runs on the window's own thread, which owns the HWND.
    fn with_hwnd<R: Runtime>(window: &Window<R>, action: impl FnOnce(HWND) + Send + 'static) {
        let target = window.clone();
        let _ = window.run_on_main_thread(move || {
            if let Ok(hwnd) = target.hwnd() {
                action(hwnd.0 as HWND);
            }
        });
    }
    pub fn show<R: Runtime>(window: &Window<R>) {
        with_hwnd(window, |hwnd| unsafe {
            // Also restores a minimized window, still without activating it.
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        });
    }
    /// Showing already puts the window on top of the other topmost windows.
    pub fn raise<R: Runtime>(window: &Window<R>) {
        show(window);
    }
    pub fn hide<R: Runtime>(window: &Window<R>) {
        keyboard(window, false);
        with_hwnd(window, |hwnd| unsafe {
            ShowWindow(hwnd, SW_HIDE);
        });
    }
    pub fn minimize<R: Runtime>(window: &Window<R>) {
        with_hwnd(window, |hwnd| unsafe {
            ShowWindow(hwnd, SW_SHOWMINNOACTIVE);
        });
    }
    pub fn keyboard<R: Runtime>(window: &Window<R>, on: bool) {
        with_hwnd(window, move |hwnd| unsafe {
            let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let next = if on {
                style & !(WS_EX_NOACTIVATE as isize)
            } else {
                style | WS_EX_NOACTIVATE as isize
            };
            if next != style {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
            }
            // Allowed because the user's click on this window was the last input.
            if on {
                SetForegroundWindow(hwnd);
            }
        });
    }
}

#[cfg(not(windows))]
mod platform {
    use super::{passive, wayland};
    use tauri::{Runtime, Window};

    pub fn show<R: Runtime>(window: &Window<R>) {
        if wayland() {
            // A Wayland window cannot take the focus while it stays mapped; the compositor
            // activates it when it is mapped again, so a window behind the game is re-shown.
            if window.is_visible().unwrap_or(false) && !window.is_focused().unwrap_or(false) {
                let _ = window.hide();
            }
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        } else {
            let _ = window.unminimize();
            let _ = window.show();
        }
    }
    /// Showing a mapped X11 window does not restack it, and raising it through the focus
    /// could take the keyboard; the window manager puts a window mapped again on top.
    pub fn raise<R: Runtime>(window: &Window<R>) {
        if !wayland() && window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        }
        show(window);
    }
    pub fn hide<R: Runtime>(window: &Window<R>) {
        keyboard(window, false);
        let _ = window.hide();
    }
    pub fn minimize<R: Runtime>(window: &Window<R>) {
        let _ = window.minimize();
    }
    pub fn keyboard<R: Runtime>(window: &Window<R>, on: bool) {
        if !passive() {
            return;
        }
        let _ = window.set_focusable(on);
        if on {
            let _ = window.set_focus();
        }
    }
}

pub use platform::{hide, keyboard, minimize, raise, show};
