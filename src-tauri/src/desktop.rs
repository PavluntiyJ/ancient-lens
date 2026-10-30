use crate::{
    api::Api,
    gsi, overlay,
    stats::Filter,
    steam_setup,
    store::{Result, Store},
};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, AtomicU16, Ordering},
    Arc,
};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tokio::sync::{Mutex, RwLock};

struct Desktop {
    store: Mutex<Store>,
    /// Replaced when STRATZ is connected or disconnected from Settings.
    api: std::sync::RwLock<Arc<Api>>,
    /// `ANCIENT_STATS_URL` chose the service; Connect must not replace that choice.
    explicit_service: bool,
    /// Held while a token is checked and the service restarted, so only one change runs.
    provider_change: Mutex<()>,
    live: Arc<RwLock<Value>>,
    port: AtomicU16,
    /// The roster reader (Linux and Windows) is switched through it; elsewhere it is just kept alive.
    #[cfg_attr(not(any(target_os = "linux", windows)), allow(dead_code))]
    gsi: Arc<gsi::Control>,
    /// Whether the match window's (`shortcut`) and the profile window's global keys are bound.
    shortcut: AtomicBool,
    profile_shortcut: AtomicBool,
    /// How the desktop portal describes the bound shortcuts (Linux); `None` for a fixed key.
    shortcut_trigger: std::sync::Mutex<Option<String>>,
    profile_trigger: std::sync::Mutex<Option<String>>,
    /// The registered global combinations, match window first, so a press finds its window.
    global_keys: std::sync::Mutex<[String; 2]>,
    /// Set once a tray icon exists; without one, closing the window must still quit.
    tray: AtomicBool,
    /// Copy of the stored setting, read by the close handler without awaiting the store.
    close_to_tray: AtomicBool,
    /// Copy of the stored setting, read when another window becomes active.
    auto_hide: AtomicBool,
    /// When activating another application last hid a visible window.
    auto_hidden: std::sync::Mutex<Option<std::time::Instant>>,
    /// Held while Steam is being closed and its settings edited, so only one repair runs.
    steam_repair: Mutex<()>,
    /// The newest release above this version from the last successful check, if any.
    release: RwLock<Option<Value>>,
    /// Wakes the release check when the setting is turned on.
    release_wake: tokio::sync::Notify,
}
impl Desktop {
    async fn release_info(&self) -> Value {
        json!({"current": env!("CARGO_PKG_VERSION"), "latest": *self.release.read().await})
    }
    fn api(&self) -> Arc<Api> {
        match self.api.read() {
            Ok(api) => api.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }
    /// Provider details for Settings; whether a token can be connected here, never the token.
    fn provider(&self, message: Option<String>) -> Value {
        let mut info = self.api().info();
        info["connectable"] = json!(!self.explicit_service);
        if let Some(message) = message {
            info["message"] = json!(message);
        }
        info
    }
    /// Point every following request at the service an outcome reports.
    fn use_service(&self, directory: std::path::PathBuf, service: Option<String>) -> Result<()> {
        let api = Api::new(directory, service)?;
        match self.api.write() {
            Ok(mut slot) => *slot = api,
            Err(poisoned) => *poisoned.into_inner() = api,
        }
        Ok(())
    }
}
/// Default global keys of the match and profile windows, used by the X11 fallback and by a
/// state file without a binding.
const SHORTCUT: &str = "Alt+Numpad5";
const PROFILE_SHORTCUT: &str = "Alt+Numpad6";
/// Window labels. The match window keeps the label of the former single window.
const MATCH: &str = "main";
const PROFILE: &str = "profile";
const WINDOWS: [&str; 2] = [MATCH, PROFILE];
/// The two global combinations of a `shortcuts` object, match window first.
fn global_keys(shortcuts: &Value) -> [String; 2] {
    [
        shortcuts["global"].as_str().unwrap_or(SHORTCUT).to_owned(),
        shortcuts["profile"]
            .as_str()
            .unwrap_or(PROFILE_SHORTCUT)
            .to_owned(),
    ]
}
/// The window whose global key was pressed; the match window when nothing else matches.
fn pressed_window(
    app: &tauri::AppHandle,
    shortcut: &tauri_plugin_global_shortcut::Shortcut,
) -> &'static str {
    let profile = app
        .try_state::<Desktop>()
        .and_then(|desktop| desktop.global_keys.lock().ok().map(|keys| keys[1].clone()));
    match profile.and_then(|key| key.parse::<tauri_plugin_global_shortcut::Shortcut>().ok()) {
        Some(profile) if profile == *shortcut => PROFILE,
        _ => MATCH,
    }
}
/// Binds both shortcuts through the desktop portal, which reaches the app whichever window has
/// the keyboard; without a portal, or when the user declines, it falls back to an X11 grab.
#[cfg(target_os = "linux")]
fn portal_shortcut(app: tauri::AppHandle, keys: [String; 2]) {
    use crate::shortcut_portal::{Binding, MATCH_ID, PROFILE_ID};
    std::thread::spawn(move || match Binding::bind() {
        Ok(binding) => {
            eprintln!("Shortcut: bound by the desktop as {:?}", binding.triggers);
            let desktop = app.state::<Desktop>();
            for (id, bound, trigger) in [
                (MATCH_ID, &desktop.shortcut, &desktop.shortcut_trigger),
                (
                    PROFILE_ID,
                    &desktop.profile_shortcut,
                    &desktop.profile_trigger,
                ),
            ] {
                let found = binding.triggers.get(id).cloned();
                bound.store(found.is_some(), Ordering::Relaxed);
                if let Ok(mut trigger) = trigger.lock() {
                    *trigger = found;
                }
            }
            let handle = app.clone();
            let ended = binding.listen(move |id| {
                let app = handle.clone();
                let label = if id == PROFILE_ID { PROFILE } else { MATCH };
                let _ = handle.run_on_main_thread(move || {
                    let _ = toggle(&app, label);
                });
            });
            eprintln!("Shortcut: {}", ended.unwrap_err());
        }
        Err(error) => {
            eprintln!("Shortcut: portal unavailable ({error}); using an X11 key grab");
            let desktop = app.state::<Desktop>();
            for (key, bound) in keys
                .iter()
                .zip([&desktop.shortcut, &desktop.profile_shortcut])
            {
                let grabbed = app.global_shortcut().register(key.as_str()).is_ok();
                bound.store(grabbed, Ordering::Relaxed);
            }
        }
    });
}
/// Brings a window up, or hides it when it is already up: the hotkeys and the tray use this.
/// It stays above the game without taking the keyboard from it (see `overlay`).
fn toggle(app: &tauri::AppHandle, label: &str) -> Result<bool> {
    let w = app
        .get_webview_window(label)
        .ok_or("The window is missing")?
        .as_ref()
        .window();
    if overlay::in_front(&w) {
        overlay::hide(&w);
        Ok(false)
    } else {
        overlay::show(&w);
        Ok(true)
    }
}
fn show(app: &tauri::AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        overlay::show(&w.as_ref().window());
    }
}
/// Shows both windows with the match window in front and the profile window behind it.
fn show_both(app: &tauri::AppHandle) {
    show(app, PROFILE);
    if let Some(w) = app.get_webview_window(MATCH) {
        overlay::raise(&w.as_ref().window());
    }
}
/// A window of process `pid` running `exe` became active. Any program but this app and the
/// game hides both windows, unless the user turned that off. Returns whether one was visible.
fn foreground(app: &tauri::AppHandle, pid: u32, exe: Option<&str>) -> bool {
    let Some(desktop) = app.try_state::<Desktop>() else {
        return false;
    };
    if !desktop.auto_hide.load(Ordering::Relaxed)
        || !crate::foreground::hide_for(pid, std::process::id(), exe)
    {
        return false;
    }
    let mut hidden = false;
    for label in WINDOWS {
        if let Some(w) = app.get_webview_window(label) {
            let w = w.as_ref().window();
            hidden |= w.is_visible().unwrap_or(false);
            overlay::hide(&w);
        }
    }
    if hidden {
        if let Ok(mut at) = desktop.auto_hidden.lock() {
            *at = Some(std::time::Instant::now());
        }
    }
    hidden
}
/// Clicking the tray icon activates the taskbar first, which already hid the windows the click
/// meant to hide; toggling then would bring them straight back.
fn just_auto_hidden(app: &tauri::AppHandle) -> bool {
    app.try_state::<Desktop>()
        .and_then(|desktop| *desktop.auto_hidden.lock().ok()?)
        .is_some_and(|at| at.elapsed() < std::time::Duration::from_secs(1))
}
/// Moves the two global keys from `previous` to `next`. Another application may own a
/// requested combination; then every binding is put back and the conflict is reported.
#[cfg(not(target_os = "linux"))]
fn rebind(app: &tauri::AppHandle, previous: &[String; 2], next: &[String; 2]) -> Result<()> {
    let manager = app.global_shortcut();
    let changed: Vec<usize> = (0..2).filter(|&i| previous[i] != next[i]).collect();
    for &i in &changed {
        let _ = manager.unregister(previous[i].as_str());
    }
    for &i in &changed {
        if manager.register(next[i].as_str()).is_err() {
            for &j in &changed {
                let _ = manager.unregister(next[j].as_str());
            }
            for &j in &changed {
                let _ = manager.register(previous[j].as_str());
            }
            return Err(format!(
                "{} is already used by another application. The previous shortcuts are still active.",
                next[i]
            ));
        }
    }
    Ok(())
}
/// Hiding to the tray is only safe when something shows the icon. Linux needs a
/// StatusNotifier host (KDE, or GNOME with the AppIndicator extension); without one the
/// window would vanish, so closing quits instead. Other systems always have a tray.
#[cfg(target_os = "linux")]
fn tray_host() -> bool {
    let check = || -> zbus::Result<bool> {
        let bus = zbus::blocking::Connection::session()?;
        let proxy = zbus::blocking::fdo::DBusProxy::new(&bus)?;
        let name = zbus::names::BusName::try_from("org.kde.StatusNotifierWatcher")?;
        Ok(proxy.name_has_owner(name)?)
    };
    check().unwrap_or(false)
}
#[cfg(not(target_os = "linux"))]
fn tray_host() -> bool {
    true
}
fn tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let show_match = MenuItem::with_id(app, "show", "Show match window", true, None::<&str>)?;
    let show_profile = MenuItem::with_id(app, "profile", "Show profile", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_match, &show_profile, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Ancient Lens")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show(app, MATCH),
            "profile" => show(app, PROFILE),
            "quit" => app.exit(0),
            _ => {}
        })
        // Linux trays only open the menu; a left click toggles the match window elsewhere.
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if !just_auto_hidden(tray.app_handle()) {
                    let _ = toggle(tray.app_handle(), MATCH);
                }
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
/// Smallest window (logical px at 100% scale) that shows the ten-player table and the
/// analysis panels together without scrolling. Measured: a real match fits 1600×900 at the
/// match screen's lowest zoom; 20px more covers taller rows (the smoke fixture needs 906).
/// 1030 wide is the zoomed canvas plus the page margins.
const MATCH_MIN: (f64, f64) = (1030., 920.);
/// The profile window scrolls; it only needs its header, the filter bar and a few rows.
const PROFILE_MIN: (f64, f64) = (900., 600.);
/// The minimum window for an interface scale (percent): everything grows with the scale, so
/// does the minimum. Never larger than the monitor's work area; only there can the match
/// screen still scroll.
fn min_size(base: (f64, f64), scale: f64, work_area: (f64, f64)) -> (f64, f64) {
    let factor = scale / 100.;
    (
        (base.0 * factor).ceil().min(work_area.0),
        (base.1 * factor).ceil().min(work_area.1),
    )
}
fn trusted(url: &tauri::Url) -> bool {
    url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
}
#[tauri::command]
async fn desktop_call(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Desktop>,
    command: String,
    args: Value,
) -> Result<Value> {
    if !WINDOWS.contains(&window.label()) || !trusted(&window.url().map_err(|e| e.to_string())?) {
        return Err("Untrusted window".into());
    }
    match command.as_str() {
        "window:resize" => {
            let direction =
                serde_json::from_value(args["edge"].clone()).map_err(|_| "Unknown window edge")?;
            if !window.is_maximized().map_err(|e| e.to_string())? {
                window
                    .as_ref()
                    .window()
                    .start_resize_dragging(direction)
                    .map_err(|e| e.to_string())?;
            }
            Ok(Value::Null)
        }
        "window:min-size" => {
            let scale = args["scale"]
                .as_f64()
                .filter(|scale| (50.0..=200.0).contains(scale))
                .ok_or("Invalid interface scale")?;
            let monitor = window
                .current_monitor()
                .map_err(|e| e.to_string())?
                .ok_or("No monitor")?;
            let factor = monitor.scale_factor();
            let work = monitor.work_area().size;
            let base = if window.label() == PROFILE {
                PROFILE_MIN
            } else {
                MATCH_MIN
            };
            let (width, height) = min_size(
                base,
                scale,
                (work.width as f64 / factor, work.height as f64 / factor),
            );
            window
                .set_min_size(Some(tauri::LogicalSize::new(width, height)))
                .map_err(|e| e.to_string())?;
            // A window already smaller than the new minimum grows to it.
            let inner = window
                .inner_size()
                .map_err(|e| e.to_string())?
                .to_logical::<f64>(factor);
            if !window.is_maximized().map_err(|e| e.to_string())?
                && (inner.width < width || inner.height < height)
            {
                window
                    .set_size(tauri::LogicalSize::new(
                        inner.width.max(width),
                        inner.height.max(height),
                    ))
                    .map_err(|e| e.to_string())?;
            }
            Ok(json!({"width": width, "height": height}))
        }
        // Isolated tests set the native window size, as WebDriver does on Linux; the Windows
        // driver (WebView2 debugging protocol) cannot.
        "window:test-size" if std::env::var_os("ANCIENT_TEST_DATA").is_some() => {
            let size = |key: &str| args[key].as_f64().filter(|v| (100.0..=10000.0).contains(v));
            let (width, height) = size("width")
                .zip(size("height"))
                .ok_or("Invalid window size")?;
            if window.is_maximized().map_err(|e| e.to_string())? {
                window.unmaximize().map_err(|e| e.to_string())?;
            }
            window
                .set_size(tauri::LogicalSize::new(width, height))
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "window:action" => {
            match args["action"].as_str().unwrap_or("") {
                "drag" => window.start_dragging(),
                "minimize" => {
                    overlay::minimize(&window.as_ref().window());
                    Ok(())
                }
                "maximize" => {
                    if window.is_maximized().map_err(|e| e.to_string())? {
                        window.unmaximize()
                    } else {
                        window.maximize()
                    }
                }
                "close" => window.close(),
                _ => return Err("Unknown window action".into()),
            }
            .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        // One consent for every memory reader: roster/picks and own rating, Linux and Windows.
        "state:reader" => {
            if !cfg!(any(target_os = "linux", windows)) {
                return Err("Dota memory reading is not supported on this platform".into());
            }
            let mut store = state.store.lock().await;
            let value = store.change(&command, &args)?;
            #[cfg(any(target_os = "linux", windows))]
            state
                .gsi
                .set_reader(value["nativeRosterReader"] == "on")
                .await;
            let _ = app.emit("state:update", &value);
            Ok(value)
        }
        "state:get" => Ok(state.store.lock().await.public()),
        "state:account" | "note:save" | "note:delete" | "mmr:add" | "mmr:delete" => {
            let value = state.store.lock().await.change(&command, &args)?;
            let _ = app.emit("state:update", &value);
            Ok(value)
        }
        "app:info" => {
            let store = state.store.lock().await;
            Ok(
                json!({"version":env!("CARGO_PKG_VERSION"),"platform":if cfg!(windows){"win32"}else{std::env::consts::OS},"runtime":"Tauri + Rust","wayland":std::env::var_os("WAYLAND_DISPLAY").is_some(),"shortcut":state.shortcut.load(Ordering::Relaxed),"shortcutKey":store.shortcuts()["global"],"shortcutTrigger":state.shortcut_trigger.lock().ok().and_then(|t| t.clone()),"profileShortcut":state.profile_shortcut.load(Ordering::Relaxed),"profileShortcutKey":store.shortcuts()["profile"],"profileShortcutTrigger":state.profile_trigger.lock().ok().and_then(|t| t.clone()),"overlay":overlay::passive(),"autoHide":crate::foreground::available(),"window":window.label(),"tray":state.tray.load(Ordering::Relaxed),"dataPath":store.directory,"gsiPort":state.port.load(Ordering::Relaxed),"readerPrompt":reader_prompt()}),
            )
        }
        "player:site" => {
            let url = crate::player_sites::url(
                args["id"].as_str().unwrap_or(""),
                args["site"].as_str().unwrap_or(""),
            )?;
            if std::env::var_os("ANCIENT_TEST_DATA").is_none() {
                crate::browser::open(&url).await?;
            }
            Ok(json!(url))
        }
        "match:site" => {
            let url = crate::player_sites::match_url(
                args["id"].as_str().unwrap_or(""),
                args["site"].as_str().unwrap_or(""),
            )?;
            if std::env::var_os("ANCIENT_TEST_DATA").is_none() {
                crate::browser::open(&url).await?;
            }
            Ok(json!(url))
        }
        "live:get" => Ok(state.live.read().await.clone()),
        "provider:get" => Ok(state.provider(None)),
        "provider:token" => {
            Err("Configure a local STRATZ service; see docs/guide/stats-service.md.".into())
        }
        "stratz:tokens" => {
            if std::env::var_os("ANCIENT_TEST_DATA").is_none() {
                crate::browser::open(crate::stratz_token::TOKENS_PAGE).await?;
            }
            Ok(json!(crate::stratz_token::TOKENS_PAGE))
        }
        // Isolated test runs never touch this computer's secret store or its service.
        "provider:connect" | "provider:disconnect"
            if std::env::var_os("ANCIENT_TEST_DATA").is_some() =>
        {
            Err("Connecting STRATZ is disabled in isolated test sessions.".into())
        }
        "provider:connect" | "provider:disconnect" => {
            if state.explicit_service {
                return Err(
                    "The statistics service is set by ANCIENT_STATS_URL for this launch.".into(),
                );
            }
            let Ok(_changing) = state.provider_change.try_lock() else {
                return Err("STRATZ is already being connected.".into());
            };
            // The token is only borrowed from the call's arguments, which are dropped on return.
            let outcome = if command == "provider:connect" {
                crate::local_service::connect(args["token"].as_str().unwrap_or("")).await?
            } else {
                crate::local_service::disconnect().await?
            };
            let directory = state.store.lock().await.directory.join("cache");
            state.use_service(directory, outcome.service)?;
            // The other window reloads what depends on the provider.
            let _ = app.emit("provider:update", Value::Null);
            Ok(state.provider(Some(outcome.message)))
        }
        "heroes:get" => state.api().resource("heroes", 3_600_000).await,
        "patches:get" => state.api().patches().await,
        "country:get" => state.api().country(args["id"].as_str().unwrap_or("")).await,
        "totals:get" => state.api().totals(args["id"].as_str().unwrap_or("")).await,
        "draft:data" => {
            let ids: Vec<u64> =
                serde_json::from_value(args["ids"].clone()).map_err(|_| "Invalid heroes")?;
            state
                .api()
                .draft_data(&ids, args["bracket"].as_str().unwrap_or("ALL"))
                .await
        }
        "averages:get" => {
            let ids: Vec<u64> =
                serde_json::from_value(args["ids"].clone()).map_err(|_| "Invalid heroes")?;
            state
                .api()
                .hero_averages(&ids, args["bracket"].as_str().unwrap_or("ALL"))
                .await
        }
        "player:get" => state.api().player(args["id"].as_str().unwrap_or("")).await,
        "journal:medal" => {
            let id = args["matchId"]
                .as_str()
                .and_then(|id| id.parse::<u64>().ok());
            let mut store = state.store.lock().await;
            if store.medal_rank(id.unwrap_or(0), args["tier"].as_u64().unwrap_or(0))? {
                let _ = app.emit("state:update", store.public());
            }
            Ok(Value::Null)
        }
        "history:get" => {
            let offset = args["offset"].as_u64().unwrap_or(0);
            if offset > 5000 {
                return Err("History limit exceeded".into());
            }
            let id = crate::store::account_id(args["id"].as_str().unwrap_or(""))?;
            let load = if args["cachedOnly"].as_bool().unwrap_or(false) {
                crate::api::HistoryLoad::Cached
            } else if args["refresh"].as_bool().unwrap_or(false) || offset > 0 {
                crate::api::HistoryLoad::Network
            } else {
                crate::api::HistoryLoad::Recent
            };
            let history = state.api().history(&id, offset as u32, load).await;
            // Matches recorded from the game stay visible when the provider has none.
            let recorded = state.store.lock().await.recorded(&id);
            let fallback = |warning: Option<String>| {
                crate::journal::local_history(&id, &state.api().info()["source"], warning)
            };
            match history {
                Ok(history) if history.is_object() => Ok(crate::journal::merge(history, &recorded)),
                Ok(_) if !recorded.is_empty() => {
                    Ok(crate::journal::merge(fallback(None), &recorded))
                }
                Err(error) if !recorded.is_empty() => {
                    Ok(crate::journal::merge(fallback(Some(error)), &recorded))
                }
                other => other,
            }
        }
        "parties:get" => {
            let ids: Vec<String> = args["ids"]
                .as_array()
                .filter(|ids| ids.len() <= 10)
                .and_then(|ids| ids.iter().map(|id| id.as_str().map(String::from)).collect())
                .ok_or("Invalid accounts")?;
            state.api().parties(&ids).await
        }
        "summary:get" => {
            state
                .api()
                .summary(
                    args["id"].as_str().unwrap_or(""),
                    args["days"]
                        .as_u64()
                        .filter(|v| *v <= 90)
                        .ok_or("Invalid period")? as u32,
                    serde_json::from_value(args.get("filter").cloned().unwrap_or(json!({})))
                        .map_err(|_| "Invalid filter")?,
                )
                .await
        }
        "period:get" => {
            let days = args["days"].as_u64().unwrap_or(30);
            if days > 90 {
                return Err("Invalid period".into());
            }
            let v = state
                .api()
                .summary(
                    args["id"].as_str().unwrap_or(""),
                    days as u32,
                    Filter::default(),
                )
                .await?;
            Ok(json!({"accountId":v["accountId"],"fetchedAt":v["fetchedAt"],"heroes":v["heroes"]}))
        }
        "matchups:get" => {
            let ids: Vec<u64> =
                serde_json::from_value(args["ids"].clone()).map_err(|_| "Invalid heroes")?;
            state.api().matchups(&ids).await
        }
        // Either window by label; the match window when none is given.
        "window:toggle" | "window:show" => {
            let label = match args["window"].as_str() {
                None | Some(MATCH) => MATCH,
                Some(PROFILE) => PROFILE,
                Some(_) => return Err("Unknown window".into()),
            };
            if command == "window:show" {
                show(&app, label);
                Ok(json!(true))
            } else {
                Ok(json!(toggle(&app, label)?))
            }
        }
        // The user clicked a text field or the keyboard button of this window.
        "window:keyboard" => {
            overlay::keyboard(&window.as_ref().window(), args["on"] == true);
            Ok(Value::Null)
        }
        "state:update-check" | "state:skip-version" => {
            let value = state.store.lock().await.change(&command, &args)?;
            if command == "state:update-check" && value["updateCheck"] == true {
                state.release_wake.notify_one();
            }
            let _ = app.emit("state:update", &value);
            Ok(value)
        }
        "release:get" => Ok(state.release_info().await),
        // Only the link of the last check is opened, never an address from the page.
        "release:open" => {
            let url = state
                .release
                .read()
                .await
                .as_ref()
                .and_then(|release| release["url"].as_str().map(String::from))
                .ok_or("No newer version is known.")?;
            if std::env::var_os("ANCIENT_TEST_DATA").is_none() {
                crate::browser::open(&url).await?;
            }
            Ok(json!(url))
        }
        "state:tray" => {
            let value = state.store.lock().await.change(&command, &args)?;
            state
                .close_to_tray
                .store(value["closeToTray"] == true, Ordering::Relaxed);
            let _ = app.emit("state:update", &value);
            Ok(value)
        }
        "state:auto-hide" => {
            let value = state.store.lock().await.change(&command, &args)?;
            state
                .auto_hide
                .store(value["autoHide"] == true, Ordering::Relaxed);
            let _ = app.emit("state:update", &value);
            Ok(value)
        }
        // Isolated tests do not watch the active window (see `run`); they report an activation
        // here instead: one of this app's windows, or another program by its file name.
        "window:test-foreground" if std::env::var_os("ANCIENT_TEST_DATA").is_some() => {
            let pid = if args["own"] == true {
                std::process::id()
            } else {
                0
            };
            Ok(json!(foreground(&app, pid, args["exe"].as_str())))
        }
        // A global binding can fail because another application owns the combination; in
        // that case the store keeps the old object and the page shows the conflict.
        "state:shortcuts" => {
            let requested = crate::store::validate_shortcuts(&args["shortcuts"])?;
            let mut store = state.store.lock().await;
            let next = global_keys(&requested);
            #[cfg(not(target_os = "linux"))]
            {
                let previous = global_keys(&store.shortcuts());
                rebind(&app, &previous, &next)?;
                for (i, bound) in [&state.shortcut, &state.profile_shortcut]
                    .into_iter()
                    .enumerate()
                {
                    if previous[i] != next[i] {
                        bound.store(true, Ordering::Relaxed);
                    }
                }
            }
            let value = store.change(&command, &json!({"shortcuts":requested}))?;
            if let Ok(mut keys) = state.global_keys.lock() {
                *keys = next;
            }
            let _ = app.emit("state:update", &value);
            Ok(value)
        }
        // Isolated test runs never look at or touch this computer's Steam.
        "steam:status" | "steam:repair" if std::env::var_os("ANCIENT_TEST_DATA").is_some() => {
            if command == "steam:repair" {
                return Err("Steam setup is disabled in isolated test sessions.".into());
            }
            serde_json::to_value(steam_setup::Status::unavailable(
                "Steam is not checked in isolated test sessions.",
            ))
            .map_err(|e| e.to_string())
        }
        "steam:status" => {
            let config = gsi::config(
                &state.store.lock().await.token(),
                state.port.load(Ordering::Relaxed),
            );
            let status = tokio::task::spawn_blocking(move || {
                steam_setup::inspect(&steam_setup::host(), &config)
            })
            .await
            .map_err(|e| e.to_string())?;
            serde_json::to_value(status).map_err(|e| e.to_string())
        }
        "steam:repair" => {
            let Ok(_running) = state.steam_repair.try_lock() else {
                return Err("Steam setup is already running.".into());
            };
            if steam_setup::in_match(
                &*state.live.read().await,
                chrono::Utc::now().timestamp_millis(),
            ) {
                return Err("Finish the current match first: the setup closes Dota 2.".into());
            }
            let launch = args["launch"].as_bool().unwrap_or(false);
            let config = gsi::config(
                &state.store.lock().await.token(),
                state.port.load(Ordering::Relaxed),
            );
            let outcome = tokio::task::spawn_blocking(move || {
                steam_setup::repair(&steam_setup::host(), &config, launch)
            })
            .await
            .map_err(|e| e.to_string())??;
            serde_json::to_value(outcome).map_err(|e| e.to_string())
        }
        "gsi:export" | "data:export" => {
            let is_gsi = command == "gsi:export";
            let (content, default_name) = if is_gsi {
                (
                    gsi::config(
                        &state.store.lock().await.token(),
                        state.port.load(Ordering::Relaxed),
                    ),
                    "gamestate_integration_ancient_lens.cfg",
                )
            } else {
                (
                    serde_json::to_string_pretty(&state.store.lock().await.export())
                        .map_err(|e| e.to_string())?,
                    "ancient-lens-backup.json",
                )
            };
            let path = rfd::AsyncFileDialog::new()
                .set_file_name(default_name)
                .save_file()
                .await;
            if let Some(path) = path {
                tokio::fs::write(path.path(), content)
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(json!(path.path().to_string_lossy()))
            } else {
                Ok(Value::Null)
            }
        }
        _ => Err("Unknown command".into()),
    }
}
/// Whether the page may offer first-run reader/STRATZ setup. Isolated test runs skip the
/// dialogs so automation never meets a modal, unless ANCIENT_READER_PROMPT=1 asks for them.
fn reader_prompt() -> bool {
    std::env::var_os("ANCIENT_TEST_DATA").is_none()
        || std::env::var_os("ANCIENT_READER_PROMPT").is_some_and(|v| v == "1")
}
/// The match and profile windows come from tauri.conf.json but are built here, so that test
/// runs on Windows can expose WebView2 to the smoke test. wry otherwise sets its
/// own browser arguments, which hide WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS.
/// A debugging port lets any local process drive the app, so it is only ever
/// opened in isolated test mode (ANCIENT_TEST_DATA). Both windows share one WebView2
/// environment, so they get the same arguments and one port shows both pages.
fn build_window(app: &tauri::App, label: &str) -> tauri::Result<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == label)
        .cloned()
        .expect("window config");
    // Shown without taking the keyboard from the game where the desktop allows it.
    let passive = overlay::passive();
    #[allow(unused_mut)]
    let mut builder = tauri::WebviewWindowBuilder::from_config(app, &config)?
        .focused(!passive)
        .focusable(!passive);
    #[cfg(windows)]
    if let Some(test_data) = std::env::var_os("ANCIENT_TEST_DATA") {
        // WebView2 otherwise keeps local storage under %LOCALAPPDATA% for every run, so tests
        // would share first-run answers with each other and with the user's real profile.
        // Linux tests isolate WebKit through XDG_DATA_HOME instead.
        builder = builder.data_directory(std::path::PathBuf::from(test_data).join("webview2"));
        if let Some(port) = std::env::var("ANCIENT_WEBVIEW_DEBUG_PORT")
            .ok()
            .and_then(|v| v.parse::<u16>().ok())
            .filter(|p| *p > 0)
        {
            // Keep wry's defaults: these flags replace them rather than append.
            builder = builder.additional_browser_args(&format!(
                "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port={port}"
            ));
        }
    }
    builder.build()?;
    Ok(())
}
/// Each window's size, position and maximized state; not whether it is shown.
const WINDOW_STATE: tauri_plugin_window_state::StateFlags =
    tauri_plugin_window_state::StateFlags::SIZE
        .union(tauri_plugin_window_state::StateFlags::POSITION)
        .union(tauri_plugin_window_state::StateFlags::MAXIMIZED);
pub fn run() {
    let isolated = std::env::var_os("ANCIENT_TEST_DATA").is_some();
    let mut builder = tauri::Builder::default()
        // Starting the app again brings both windows back, the match window in front.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_both(app)
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = toggle(app, pressed_window(app, shortcut));
                    }
                })
                .build(),
        );
    // Isolated test runs neither read nor write this computer's saved window places.
    if !isolated {
        builder = builder.plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(WINDOW_STATE)
                // Restored in setup, after the first-start size.
                .skip_initial_state(MATCH)
                .skip_initial_state(PROFILE)
                .build(),
        );
    }
    let builder = builder
        .invoke_handler(tauri::generate_handler![desktop_call])
        .on_window_event(|window, event| {
            if !WINDOWS.contains(&window.label()) {
                return;
            }
            match event {
                // A window that had the keyboard gives it back with the focus, so the next
                // click on it leaves the game in front again.
                tauri::WindowEvent::Focused(false) => overlay::keyboard(window, false),
                // Closing hides the window. The app keeps running in the tray, so GSI and the
                // rating reader go on; Quit is in its menu. Without a tray, closing the last
                // visible window quits.
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    let desktop = window.state::<Desktop>();
                    let tray = desktop.tray.load(Ordering::Relaxed)
                        && desktop.close_to_tray.load(Ordering::Relaxed);
                    let other = WINDOWS
                        .iter()
                        .filter(|label| **label != window.label())
                        .filter_map(|label| window.app_handle().get_webview_window(label))
                        .any(|w| w.is_visible().unwrap_or(false));
                    if tray || other {
                        api.prevent_close();
                        overlay::hide(window);
                    } else {
                        window.app_handle().exit(0);
                    }
                }
                _ => {}
            }
        })
        .setup(move |app| {
            let directory = std::env::var_os("ANCIENT_TEST_DATA")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| {
                    dirs::config_dir()
                        .expect("User config directory")
                        .join("Ancient Lens")
                });
            let store = Store::open(directory.clone()).map_err(std::io::Error::other)?;
            let token = store.token();
            let live = Arc::new(RwLock::new(json!({"status":"waiting","receivedAt":null})));
            let explicit_service = std::env::var("ANCIENT_STATS_URL")
                .ok()
                .or_else(|| option_env!("ANCIENT_STATS_URL").map(String::from));
            let explicit = explicit_service.is_some();
            let broker = tauri::async_runtime::block_on(crate::local_service::resolve(
                explicit_service,
                std::env::var_os("ANCIENT_TEST_DATA").is_some(),
            ));
            let api =
                tauri::async_runtime::block_on(async { Api::new(directory.join("cache"), broker) })
                    .map_err(std::io::Error::other)?;
            let port = if std::env::var_os("ANCIENT_TEST_DATA").is_some() {
                0
            } else {
                32123
            };
            let handle = app.handle().clone();
            let (port, gsi) = tauri::async_runtime::block_on(gsi::start(
                port,
                token,
                live.clone(),
                store.public()["nativeRosterReader"] == "on",
                directory.clone(),
                move |v| {
                    let _ = handle.emit("live:update", v);
                },
                {
                    let handle = app.handle().clone();
                    move |record| {
                        let handle = handle.clone();
                        tauri::async_runtime::spawn(async move {
                            let Some(state) = handle.try_state::<Desktop>() else {
                                return;
                            };
                            let mut store = state.store.lock().await;
                            match store.record_match(record) {
                                Ok(true) => {
                                    let _ = handle.emit("state:update", store.public());
                                }
                                Ok(false) => {}
                                Err(error) => eprintln!("Match journal: {error}"),
                            }
                        });
                    }
                },
            ))
            .map_err(std::io::Error::other)?;
            for label in WINDOWS {
                build_window(app, label)?;
            }
            // Linux binds the shortcuts through the desktop portal in the background below.
            let keys = global_keys(&store.shortcuts());
            let [shortcut, profile_shortcut] = [0, 1].map(|i| {
                !cfg!(target_os = "linux")
                    && app.global_shortcut().register(keys[i].as_str()).is_ok()
            });
            // Isolated test runs keep the old close-to-quit behaviour and leave the tray alone.
            let has_tray =
                std::env::var_os("ANCIENT_TEST_DATA").is_none() && tray_host() && tray(app).is_ok();
            let close_to_tray = store.close_to_tray();
            let auto_hide = store.auto_hide();
            app.manage(Desktop {
                store: Mutex::new(store),
                api: std::sync::RwLock::new(api),
                explicit_service: explicit,
                provider_change: Mutex::new(()),
                live,
                port: AtomicU16::new(port),
                gsi,
                shortcut: AtomicBool::new(shortcut),
                profile_shortcut: AtomicBool::new(profile_shortcut),
                shortcut_trigger: std::sync::Mutex::new(None),
                profile_trigger: std::sync::Mutex::new(None),
                global_keys: std::sync::Mutex::new(keys.clone()),
                tray: AtomicBool::new(has_tray),
                close_to_tray: AtomicBool::new(close_to_tray),
                auto_hide: AtomicBool::new(auto_hide),
                auto_hidden: std::sync::Mutex::new(None),
                steam_repair: Mutex::new(()),
                release: RwLock::new(None),
                release_wake: tokio::sync::Notify::new(),
            });
            #[cfg(target_os = "linux")]
            if !isolated {
                portal_shortcut(app.handle().clone(), keys);
            }
            // Isolated runs leave the windows up whatever the user activates, so tests stay
            // deterministic; ANCIENT_TEST_AUTO_HIDE=1 watches as a normal session does.
            if !isolated || std::env::var_os("ANCIENT_TEST_AUTO_HIDE").is_some_and(|v| v == "1") {
                let handle = app.handle().clone();
                // Setup runs on the main thread, whose message loop delivers the Windows hook.
                let watched = crate::foreground::watch(move |pid, exe| {
                    let app = handle.clone();
                    let _ = handle.run_on_main_thread(move || {
                        foreground(&app, pid, exe.as_deref());
                    });
                });
                if let Err(error) = watched {
                    eprintln!("Active window: {error}; the windows stay up for other apps");
                }
            }
            // Optional fixture feed only in isolated tests; never read it in a normal session.
            let test_feed = isolated
                .then(|| std::env::var_os("ANCIENT_TEST_ACCOUNT_FEED"))
                .flatten()
                .map(std::path::PathBuf::from);
            if !isolated || test_feed.is_some() {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let mut reader = crate::own_account::Reader::default();
                    loop {
                        let live = handle.state::<Desktop>().live.read().await.clone();
                        let memory = handle.state::<Desktop>().store.lock().await.memory_reader();
                        let feed = test_feed.clone();
                        // PE hashing and Win32 reads run away from both the UI and async executor.
                        let result = tokio::task::spawn_blocking(move || {
                            let observation = if let Some(path) = feed {
                                std::fs::read(path)
                                    .ok()
                                    .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                                    .unwrap_or_else(|| {
                                        crate::own_account::Observation::unavailable(
                                            None,
                                            "waiting",
                                            "test-fixture",
                                        )
                                    })
                            } else {
                                reader.poll(&live, memory)
                            };
                            (reader, observation)
                        })
                        .await;
                        let Ok((returned, observation)) = result else {
                            break;
                        };
                        reader = returned;
                        let state = handle.state::<Desktop>();
                        let mut store = state.store.lock().await;
                        match store.observe_account(observation) {
                            // Full state only when stored data changed; otherwise the live reading.
                            Ok(true) => {
                                let _ = handle.emit("state:update", store.public());
                            }
                            Ok(false) => {
                                let _ = handle.emit("own:update", store.own_public());
                            }
                            Err(error) => eprintln!("Own account update: {error}"),
                        }
                        drop(store);
                        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                    }
                });
            }
            if !isolated {
                tauri::async_runtime::spawn(match_details(app.handle().clone()));
            }
            // Isolated tests never ask GitHub; they may read a fixture release list instead.
            let releases = isolated
                .then(|| std::env::var_os("ANCIENT_TEST_RELEASES"))
                .flatten()
                .map(std::path::PathBuf::from);
            if !isolated || releases.is_some() {
                tauri::async_runtime::spawn(release_check(app.handle().clone(), releases));
            }
            // First start: the match window nearly fills the screen, the profile window is
            // a little smaller; later starts restore the size of each and where the user left
            // the match window. The profile window always opens in the middle of the screen.
            for (label, most) in [(MATCH, (1740., 1280.)), (PROFILE, (1600., 1000.))] {
                let Some(w) = app.get_webview_window(label) else {
                    continue;
                };
                if let Ok(Some(m)) = w.current_monitor() {
                    let scale = m.scale_factor();
                    let width = (m.size().width as f64 / scale - 40.).min(most.0);
                    let height = (m.size().height as f64 / scale - 90.).min(most.1);
                    let _ = w.set_size(tauri::LogicalSize::new(width, height));
                    let _ = w.center();
                }
                if !isolated {
                    use tauri_plugin_window_state::{StateFlags, WindowExt};
                    if label == PROFILE {
                        let _ = w.restore_state(WINDOW_STATE.difference(StateFlags::POSITION));
                        if !w.is_maximized().unwrap_or(false) {
                            let _ = w.center();
                        }
                    } else {
                        let _ = w.restore_state(WINDOW_STATE);
                    }
                }
            }
            // The profile window, built second, starts in front; the match window goes on top.
            show_both(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!());
    let app = match builder {
        Ok(app) => app,
        Err(error) => {
            rfd::MessageDialog::new()
                .set_title("Ancient Lens — startup error")
                .set_description(format!(
                    "{error}\n\nClose any other Ancient Lens instance if the GSI port is in use."
                ))
                .set_level(rfd::MessageLevel::Error)
                .show();
            return;
        }
    };
    app.run(|_, event| {
        if let tauri::RunEvent::Exit = event {
            crate::local_service::stop();
        }
    });
}

/// Asks for the release list shortly after start, then every few hours and whenever the
/// setting is turned on. Without network the previous answer stays and the page shows nothing.
async fn release_check(handle: tauri::AppHandle, fixture: Option<std::path::PathBuf>) {
    let client = crate::releases::client();
    if fixture.is_none() {
        tokio::time::sleep(crate::releases::FIRST_CHECK).await;
    }
    let state = handle.state::<Desktop>();
    loop {
        if state.store.lock().await.update_check() {
            let releases = match &fixture {
                Some(path) => tokio::fs::read(path)
                    .await
                    .ok()
                    .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                    .ok_or_else(|| "No release fixture".to_string()),
                None => crate::releases::fetch(&client).await,
            };
            if let Ok(releases) = releases {
                *state.release.write().await =
                    crate::releases::newest(&releases, env!("CARGO_PKG_VERSION"));
                let _ = handle.emit("release:update", state.release_info().await);
            }
        }
        tokio::select! {
            _ = tokio::time::sleep(crate::releases::INTERVAL) => {}
            _ = state.release_wake.notified() => {}
        }
    }
}
/// Completes recorded matches from their match data: STRATZ (with IMP and position) when a
/// service is configured, otherwise or failing that OpenDota. A record is retried on the
/// journal schedule until it is complete or out of attempts.
async fn match_details(handle: tauri::AppHandle) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        let state = handle.state::<Desktop>();
        let stratz = state.api().stratz_service();
        let now = chrono::Utc::now().timestamp();
        let due = state.store.lock().await.details_due(now, stratz, 2);
        for record in due {
            let (Some(account), Some(id)) =
                (record["accountId"].as_str(), record["match_id"].as_u64())
            else {
                continue;
            };
            let mut found = vec![];
            if stratz {
                match state.api().stratz_match(id).await {
                    Ok(value) => found.push(value),
                    Err(error) => eprintln!("Match details {id}: {error}"),
                }
            }
            let has_stats = record["details"].as_array().is_some_and(|s| !s.is_empty())
                || found
                    .iter()
                    .any(|m| crate::match_details::own(&record, m).is_some());
            if !has_stats {
                match state.api().opendota_match(id).await {
                    Ok(value) => found.push(value),
                    Err(error) => eprintln!("Match details {id}: {error}"),
                }
            }
            let mut store = state.store.lock().await;
            match store.save_details(account, id, &found, &crate::store::now()) {
                Ok(true) => {
                    let _ = handle.emit("state:update", store.public());
                }
                Ok(false) => {}
                Err(error) => eprintln!("Match details {id}: {error}"),
            }
        }
    }
}

#[cfg(test)]
mod window_tests {
    use super::*;
    #[test]
    fn minimum_window_follows_the_scale_within_the_work_area() {
        assert_eq!(min_size(MATCH_MIN, 100., (2560., 1400.)), (1030., 920.));
        assert_eq!(min_size(MATCH_MIN, 120., (2560., 1400.)), (1236., 1104.));
        assert_eq!(min_size(MATCH_MIN, 80., (1366., 768.)), (824., 736.));
        // A screen too small for the scale caps the minimum at its work area.
        assert_eq!(min_size(MATCH_MIN, 120., (1920., 1036.)), (1236., 1036.));
        assert_eq!(min_size(PROFILE_MIN, 100., (1366., 768.)), (900., 600.));
    }
    #[test]
    fn global_keys_fall_back_to_the_defaults() {
        assert_eq!(
            global_keys(&json!({"global":"Ctrl+Alt+F10","profile":"Alt+F11"})),
            ["Ctrl+Alt+F10".to_owned(), "Alt+F11".to_owned()]
        );
        assert_eq!(
            global_keys(&json!({})),
            [SHORTCUT.to_owned(), PROFILE_SHORTCUT.to_owned()]
        );
    }
}
