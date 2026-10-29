pub mod api;
pub mod averages;
pub mod broker;
#[cfg(feature = "desktop")]
mod browser;
#[cfg(feature = "desktop")]
pub mod desktop;
pub mod draft;
pub mod gsi;
pub mod history;
pub mod journal;
pub mod local_service;
pub mod match_details;
#[cfg(feature = "desktop")]
pub mod overlay;
pub mod own_account;
pub mod player_sites;
pub mod releases;
#[cfg(any(target_os = "linux", windows))]
pub mod roster;
#[cfg(all(feature = "desktop", target_os = "linux"))]
pub mod shortcut_portal;
pub mod stats;
pub mod steam_setup;
pub mod store;
pub mod stratz_token;
