use crate::{
    api::Api,
    gsi,
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
    shortcut: AtomicBool,
    /// How the desktop portal describes the bound shortcut (Linux); `None` for the fixed key.
    shortcut_trigger: std::sync::Mutex<Option<String>>,
    /// Set once a tray icon exists; without one, closing the window must still quit.
    tray: AtomicBool,
    /// Copy of the stored setting, read by the close handler without awaiting the store.
    close_to_tray: AtomicBool,
    /// Held while Steam is being closed and its settings edited, so only one repair runs.
    steam_repair: Mutex<()>,
}
impl Desktop {
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
/// Default global key, used by the X11 fallback and by a state file without a binding.
const SHORTCUT: &str = "Alt+Numpad5";
/// Binds the shortcut through the desktop portal, which reaches the app whichever window has
/// the keyboard; without a portal, or when the user declines, it falls back to an X11 grab.
#[cfg(target_os = "linux")]
fn portal_shortcut(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        match crate::shortcut_portal::Binding::bind("Show or hide Ancient Lens") {
            Ok(binding) => {
                eprintln!("Shortcut: bound by the desktop as {:?}", binding.trigger);
                let desktop = app.state::<Desktop>();
                desktop.shortcut.store(true, Ordering::Relaxed);
                if let Ok(mut trigger) = desktop.shortcut_trigger.lock() {
                    *trigger = Some(binding.trigger.clone());
                }
                let handle = app.clone();
                let ended = binding.listen(move || {
                    let app = handle.clone();
                    let _ = handle.run_on_main_thread(move || {
                        let _ = toggle_main(&app);
                    });
                });
                eprintln!("Shortcut: {}", ended.unwrap_err());
            }
            Err(error) => {
                eprintln!("Shortcut: portal unavailable ({error}); using an X11 key grab");
                let grabbed = app.global_shortcut().register(SHORTCUT).is_ok();
                app.state::<Desktop>()
                    .shortcut
                    .store(grabbed, Ordering::Relaxed);
            }
        }
    });
}
/// Brings the main window up, or hides it when it is already in front: the hotkey and the
/// tray use this one window instead of a separate match panel. A window that is open but
/// buried under the game is raised, not hidden, so one press always shows it.
fn toggle_main(app: &tauri::AppHandle) -> Result<bool> {
    let w = app
        .get_webview_window("main")
        .ok_or("Main window is missing")?;
    let front = w.is_visible().unwrap_or(false)
        && !w.is_minimized().unwrap_or(false)
        && w.is_focused().unwrap_or(false);
    if front {
        w.hide().map_err(|e| e.to_string())?;
        Ok(false)
    } else {
        show_main(app);
        Ok(true)
    }
}
fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        // A Wayland window cannot take the focus while it stays mapped; the compositor
        // activates it when it is mapped again, so a window behind the game is re-shown.
        #[cfg(target_os = "linux")]
        if w.is_visible().unwrap_or(false) && !w.is_focused().unwrap_or(false) {
            let _ = w.hide();
        }
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
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
    let show = MenuItem::with_id(app, "show", "Show Ancient Lens", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Ancient Lens")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        // Linux trays only open the menu; a left click toggles the window elsewhere.
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = toggle_main(tray.app_handle());
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
/// The minimum window for an interface scale (percent): everything grows with the scale, so
/// does the minimum. Never larger than the monitor's work area; only there can the match
/// screen still scroll.
fn match_min_size(scale: f64, work_area: (f64, f64)) -> (f64, f64) {
    let factor = scale / 100.;
    (
        (MATCH_MIN.0 * factor).ceil().min(work_area.0),
        (MATCH_MIN.1 * factor).ceil().min(work_area.1),
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
    if window.label() != "main" || !trusted(&window.url().map_err(|e| e.to_string())?) {
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
            let (width, height) = match_min_size(
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
        "window:action" => {
            match args["action"].as_str().unwrap_or("") {
                "drag" => window.start_dragging(),
                "minimize" => window.minimize(),
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
                json!({"version":env!("CARGO_PKG_VERSION"),"platform":if cfg!(windows){"win32"}else{std::env::consts::OS},"runtime":"Tauri + Rust","wayland":std::env::var_os("WAYLAND_DISPLAY").is_some(),"shortcut":state.shortcut.load(Ordering::Relaxed),"shortcutKey":store.shortcuts()["global"],"shortcutTrigger":state.shortcut_trigger.lock().ok().and_then(|t| t.clone()),"tray":state.tray.load(Ordering::Relaxed),"dataPath":store.directory,"gsiPort":state.port.load(Ordering::Relaxed),"readerPrompt":reader_prompt()}),
            )
        }
        "player:site" => {
            let url = crate::player_sites::url(
                args["id"].as_str().unwrap_or(""),
                args["site"].as_str().unwrap_or(""),
            )?;
            if std::env::var_os("ANCIENT_TEST_DATA").is_none() {
                open::that_detached(&url)
                    .map_err(|e| format!("Could not open the browser: {e}"))?;
            }
            Ok(json!(url))
        }
        "match:site" => {
            let url = crate::player_sites::match_url(
                args["id"].as_str().unwrap_or(""),
                args["site"].as_str().unwrap_or(""),
            )?;
            if std::env::var_os("ANCIENT_TEST_DATA").is_none() {
                open::that_detached(&url)
                    .map_err(|e| format!("Could not open the browser: {e}"))?;
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
                open::that_detached(crate::stratz_token::TOKENS_PAGE)
                    .map_err(|e| format!("Could not open the browser: {e}"))?;
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
        "window:toggle" => Ok(json!(toggle_main(&app)?)),
        "state:tray" => {
            let value = state.store.lock().await.change(&command, &args)?;
            state
                .close_to_tray
                .store(value["closeToTray"] == true, Ordering::Relaxed);
            Ok(value)
        }
        // The global binding can fail because another application owns the combination; in
        // that case the store keeps the old object and the page shows the conflict.
        "state:shortcuts" => {
            let requested = crate::store::validate_shortcuts(&args["shortcuts"])?;
            let mut store = state.store.lock().await;
            #[cfg(not(target_os = "linux"))]
            {
                let previous = store.shortcuts()["global"]
                    .as_str()
                    .unwrap_or(SHORTCUT)
                    .to_owned();
                let next = requested["global"].as_str().unwrap_or(SHORTCUT);
                if next != previous {
                    let manager = app.global_shortcut();
                    let _ = manager.unregister(previous.as_str());
                    if manager.register(next).is_err() {
                        // Restore the working binding before reporting the conflict.
                        let _ = manager.register(previous.as_str());
                        return Err(format!(
                            "{next} is already used by another application. The previous shortcut is still active."
                        ));
                    }
                }
            }
            store.change(&command, &json!({"shortcuts":requested}))
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
/// Whether the page may ask once to enable the memory reader. Isolated test runs skip the
/// question so automation never meets a modal, unless ANCIENT_READER_PROMPT=1 asks for it.
fn reader_prompt() -> bool {
    std::env::var_os("ANCIENT_TEST_DATA").is_none()
        || std::env::var_os("ANCIENT_READER_PROMPT").is_some_and(|v| v == "1")
}
/// The main window comes from tauri.conf.json but is built here, so that test
/// runs on Windows can expose WebView2 to the smoke test. wry otherwise sets its
/// own browser arguments, which hide WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS.
/// A debugging port lets any local process drive the app, so it is only ever
/// opened in isolated test mode (ANCIENT_TEST_DATA).
fn main_window(app: &tauri::App) -> tauri::Result<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
        .expect("main window config");
    #[allow(unused_mut)]
    let mut builder = tauri::WebviewWindowBuilder::from_config(app, &config)?;
    #[cfg(windows)]
    if std::env::var_os("ANCIENT_TEST_DATA").is_some() {
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
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main(app)
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = toggle_main(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![desktop_call])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() != "main" {
                    return;
                }
                // Hide to the tray, so GSI and the rating reader keep running; Quit is in its menu.
                let tray = window.state::<Desktop>();
                if tray.tray.load(Ordering::Relaxed) && tray.close_to_tray.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    window.app_handle().exit(0);
                }
            }
        })
        .setup(|app| {
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
            main_window(app)?;
            // Linux binds the shortcut through the desktop portal in the background below.
            let global = store.shortcuts()["global"]
                .as_str()
                .unwrap_or(SHORTCUT)
                .to_owned();
            let shortcut = !cfg!(target_os = "linux")
                && app.global_shortcut().register(global.as_str()).is_ok();
            // Isolated test runs keep the old close-to-quit behaviour and leave the tray alone.
            let has_tray =
                std::env::var_os("ANCIENT_TEST_DATA").is_none() && tray_host() && tray(app).is_ok();
            let close_to_tray = store.close_to_tray();
            app.manage(Desktop {
                store: Mutex::new(store),
                api: std::sync::RwLock::new(api),
                explicit_service: explicit,
                provider_change: Mutex::new(()),
                live,
                port: AtomicU16::new(port),
                gsi,
                shortcut: AtomicBool::new(shortcut),
                shortcut_trigger: std::sync::Mutex::new(None),
                tray: AtomicBool::new(has_tray),
                close_to_tray: AtomicBool::new(close_to_tray),
                steam_repair: Mutex::new(()),
            });
            let isolated = std::env::var_os("ANCIENT_TEST_DATA").is_some();
            #[cfg(target_os = "linux")]
            if !isolated {
                portal_shortcut(app.handle().clone());
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
            if let Some(w) = app.get_webview_window("main") {
                if let Ok(Some(m)) = w.current_monitor() {
                    let scale = m.scale_factor();
                    let width = (m.size().width as f64 / scale - 40.).min(1740.);
                    let height = (m.size().height as f64 / scale - 90.).min(1280.);
                    let _ = w.set_size(tauri::LogicalSize::new(width, height));
                    let _ = w.center();
                }
            }
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
        assert_eq!(match_min_size(100., (2560., 1400.)), (1030., 920.));
        assert_eq!(match_min_size(120., (2560., 1400.)), (1236., 1104.));
        assert_eq!(match_min_size(80., (1366., 768.)), (824., 736.));
        // A screen too small for the scale caps the minimum at its work area.
        assert_eq!(match_min_size(120., (1920., 1036.)), (1236., 1036.));
    }
}
