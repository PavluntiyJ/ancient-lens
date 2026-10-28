#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    // WebKitGTK can create the DOM but fail to paint on NVIDIA/Wayland
    // (GBM buffer allocation errors). Set this before GTK or worker threads
    // start, and preserve an explicit user override.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WAYLAND_DISPLAY").is_some()
        && std::path::Path::new("/proc/driver/nvidia/version").exists()
        && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    ancient_lens::desktop::run();
}
