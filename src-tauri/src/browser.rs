//! Open allowlisted site URLs outside the app, without AppImage library overrides.
use std::process::{Command, Stdio};
use std::time::Duration;

pub async fn open(url: &str) -> Result<(), String> {
    let mut commands = open::commands(url);
    #[cfg(target_os = "linux")]
    if std::env::var_os("APPIMAGE").is_some() {
        for command in &mut commands {
            clean_appimage(command);
        }
    }
    launch(commands).await
}

async fn launch(commands: Vec<Command>) -> Result<(), String> {
    for command in commands {
        let mut command = tokio::process::Command::from(command);
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let Ok(mut child) = command.spawn() else {
            continue;
        };
        // Some browser launchers remain alive with the browser. Do not kill one on timeout,
        // or try another launcher and open duplicate tabs; report that handoff is unconfirmed.
        match tokio::time::timeout(Duration::from_secs(15), child.wait()).await {
            Ok(Ok(status)) if status.success() => return Ok(()),
            Err(_) => return Err("The browser did not confirm opening the page. Copy the website address into your browser.".into()),
            _ => continue,
        }
    }
    Err("Could not open the browser. Copy the website address into your browser.".into())
}

#[cfg(target_os = "linux")]
fn clean_appimage(command: &mut Command) {
    // The system's URL handler must use system libraries, not the bundled GTK/Qt stack.
    for name in [
        "LD_LIBRARY_PATH",
        "LD_PRELOAD",
        "GDK_PIXBUF_MODULE_FILE",
        "GIO_EXTRA_MODULES",
        "GSETTINGS_SCHEMA_DIR",
        "GST_PLUGIN_SYSTEM_PATH",
        "GST_PLUGIN_SYSTEM_PATH_1_0",
        "GTK_DATA_PREFIX",
        "GTK_EXE_PREFIX",
        "GTK_IM_MODULE_FILE",
        "GTK_PATH",
        "QT_PLUGIN_PATH",
        "PERLLIB",
        "PYTHONHOME",
        "PYTHONPATH",
        "APPDIR",
        "APPIMAGE",
        "ARGV0",
        "OWD",
    ] {
        command.env_remove(name);
    }
    if let Some(appdir) = std::env::var_os("APPDIR") {
        for name in ["PATH", "XDG_DATA_DIRS"] {
            if let Some(value) = std::env::var_os(name) {
                let paths: Vec<_> = std::env::split_paths(&value)
                    .filter(|path| !path.starts_with(&appdir))
                    .collect();
                if let Ok(value) = std::env::join_paths(paths) {
                    command.env(name, value);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn checks_exit_status_and_tries_the_next_launcher() {
        let shell = |exit: &str| {
            #[cfg(windows)]
            let mut command = Command::new("cmd.exe");
            #[cfg(windows)]
            command.args(["/C", exit]);
            #[cfg(not(windows))]
            let mut command = Command::new("/bin/sh");
            #[cfg(not(windows))]
            command.args(["-c", exit]);
            command
        };
        assert!(launch(vec![shell("exit 1"), shell("exit 0")]).await.is_ok());
        assert!(launch(vec![shell("exit 1")]).await.is_err());
        assert!(launch(vec![Command::new("/nonexistent/browser")])
            .await
            .is_err());
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn appimage_launch_uses_the_system_handler_and_environment() {
        // Run in a child test process: never change the environment of parallel tests,
        // and never reach the real system browser.
        if std::env::var_os("ANCIENT_BROWSER_TEST_CHILD").is_some() {
            assert!(open("https://stratz.com/api").await.is_ok());
            return;
        }
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir().unwrap();
        let appdir = temp.path().join("bundle");
        let bundled_bin = appdir.join("usr/bin");
        let system_bin = temp.path().join("system-bin");
        std::fs::create_dir_all(&bundled_bin).unwrap();
        std::fs::create_dir(&system_bin).unwrap();
        let handler = system_bin.join("xdg-open");
        std::fs::write(&handler, "#!/bin/sh\n[ -z \"$LD_LIBRARY_PATH$GTK_PATH$APPDIR$APPIMAGE\" ] || exit 1\n[ \"$XDG_DATA_DIRS\" = /fixture/share ] || exit 1\n[ \"$1\" = https://stratz.com/api ] || exit 1\nprintf opened > \"$ANCIENT_BROWSER_TEST_LOG\"\n").unwrap();
        std::fs::set_permissions(&handler, std::fs::Permissions::from_mode(0o700)).unwrap();
        let bundled_handler = bundled_bin.join("xdg-open");
        std::fs::write(&bundled_handler, "#!/bin/sh\nexit 1\n").unwrap();
        std::fs::set_permissions(&bundled_handler, std::fs::Permissions::from_mode(0o700)).unwrap();
        let log = temp.path().join("opened");
        let status = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "browser::tests::appimage_launch_uses_the_system_handler_and_environment",
            ])
            .env("ANCIENT_BROWSER_TEST_CHILD", "1")
            .env("ANCIENT_BROWSER_TEST_LOG", &log)
            .env("APPIMAGE", temp.path().join("Ancient.AppImage"))
            .env("APPDIR", &appdir)
            .env("LD_LIBRARY_PATH", appdir.join("usr/lib"))
            .env("GTK_PATH", appdir.join("usr/lib/gtk"))
            .env(
                "PATH",
                std::env::join_paths([bundled_bin, system_bin]).unwrap(),
            )
            .env(
                "XDG_DATA_DIRS",
                std::env::join_paths([appdir.join("usr/share"), "/fixture/share".into()]).unwrap(),
            )
            .status()
            .unwrap();
        assert!(status.success());
        assert_eq!(std::fs::read_to_string(log).unwrap(), "opened");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn system_launcher_does_not_inherit_bundled_libraries() {
        let mut command = Command::new("xdg-open");
        command.env("LD_LIBRARY_PATH", "/bundle/usr/lib");
        command.env("GTK_PATH", "/bundle/usr/lib/gtk");
        command.env("DISPLAY", ":42");
        command.env("DBUS_SESSION_BUS_ADDRESS", "unix:path=/fixture/bus");
        clean_appimage(&mut command);
        let env: std::collections::HashMap<_, _> = command.get_envs().collect();
        assert_eq!(env[std::ffi::OsStr::new("LD_LIBRARY_PATH")], None);
        assert_eq!(env[std::ffi::OsStr::new("GTK_PATH")], None);
        assert_eq!(
            env[std::ffi::OsStr::new("DISPLAY")],
            Some(std::ffi::OsStr::new(":42"))
        );
        assert_eq!(
            env[std::ffi::OsStr::new("DBUS_SESSION_BUS_ADDRESS")],
            Some(std::ffi::OsStr::new("unix:path=/fixture/bus"))
        );
    }
}
