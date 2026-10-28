# Fedora setup

Ancient Lens is a Tauri/Rust desktop prototype. Fedora KDE/Wayland has been tested
with native WebKitGTK, Rust IPC, synthetic GSI, public OpenDota, and a personal
STRATZ service. Live-game coverage is documented separately in
[verification](../dev/verification.md) and [status](../status.md).

## Dependencies and build

```sh
sudo dnf install git nodejs npm gcc gcc-c++ make pkgconf-pkg-config \
  webkit2gtk4.1-devel openssl-devel curl wget file \
  libappindicator-gtk3-devel librsvg2-devel libxdo-devel
```

Install Rust stable using the [official Rust instructions](https://www.rust-lang.org/tools/install).
Use Node.js 22.12+ and open a new terminal after installation. The
[Tauri Fedora prerequisites](https://v2.tauri.app/start/prerequisites/#linux)
cover system libraries; Silverblue/Kinoite users should follow the OSTree section.

```sh
git clone https://github.com/PavluntiyJ/ancient-lens.git
cd ancient-lens
node --version
rustc --version
npm ci
npm run check
npm run dev
```

For an optimized executable:

```sh
npm run build
./src-tauri/target/release/ancient-lens
```

OpenDota is the default. Notes and the MMR journal work locally; public-statistics
availability is independent of the GSI connection. Linux identifies your account
from the Steam login that launched Dota, with fresh self GSI as a fallback. Exact
MMR and confidence come from the optional memory reader; the manual journal remains
available. Old entries without an account remain in
exports and are not assigned to a guessed owner.

`npm run dist:linux` builds AppImage and Debian packages. Use AppImage or the
Fedora-built executable on Fedora. Temporary GitHub Actions artifacts require a
GitHub login to download; they are not published release downloads.

## Personal STRATZ service

For an unsaved token and no desktop integration, follow the
[cross-platform service guide](stats-service.md). For a menu shortcut with secure
credential storage, install these additional dependencies:

```sh
sudo dnf install python3 libsecret kdialog
cargo build --release --locked --manifest-path src-tauri/Cargo.toml --no-default-features --bin stats-service
python3 scripts/launch-fedora.py --install
```

You need a working desktop Secret Service and user systemd session. Open
**Ancient Lens** from the application menu, or run:

```sh
python3 scripts/launch-fedora.py
```

The first launch asks for your own STRATZ token from
[My Tokens](https://stratz.com/api). New/replaced tokens are validated before being
saved. The token goes to the system keyring through stdin; it is not written into
the shortcut, systemd unit, or app configuration. The service receives it through
its process environment. There is no plaintext-file fallback if the keyring is
unavailable. If the keyring is locked, unlock it using your desktop.

Subsequent launches reuse the stored token and running service. To replace the
token, select **Configure STRATZ** from the shortcut menu, or run:

```sh
python3 scripts/launch-fedora.py --configure
```

The service starts on demand, not automatically at login, and remains running
until logout. systemd restarts it after failures with a restart-rate limit. Its
initial upstream budget is 60 requests/hour; check your current STRATZ quota.
No separate token-validation request runs at each launch, allowing cached data
to remain available offline.

```sh
systemctl --user stop ancient-lens-stats.service
```

The next app launch can start it again. To delete the stored token, stop the
service first, then run:

```sh
secret-tool clear application org.ancientlens service stratz
```

For manual development, `python3 scripts/start-personal-stratz.py --dialog`
validates and saves a token, then runs until Ctrl+C. `--session-only` disables
storage; `--saved-token` requires an already-stored token. Do not run a manual
and a systemd-managed service on the same port simultaneously.

### Direct app launch

The Linux app discovers a compatible service already running on `127.0.0.1:8787`.
If the user service is installed but stopped, it starts it automatically. The
menu launcher remains useful for first-time token setup. Explicit
`ANCIENT_STATS_URL` takes precedence; an empty value disables discovery. The
token is never passed into the desktop UI.

The generated shortcut and service refer to the checkout's absolute path. If
you move the repository, run `--install` again. To remove desktop integration,
stop the service, remove its unit from `~/.config/systemd/user/` and the
`org.ancientlens.desktop` shortcut from `~/.local/share/applications/`, then run
`systemctl --user daemon-reload`. Delete the keyring token separately if desired.

## Dota and the match window

Follow the [GSI setup guide](setup.md). Use the actual Steam library location;
Flatpak Steam and secondary disks may use different paths. A configuration from
another installation has a different token and will not work unchanged.
Start by spectating a match and check GSI status, match ID, ten slots, and provider.
Spectator success does not establish participant-roster availability.

The optional Linux memory reader supplies roster, picks, hovers, lanes, and bans
where the game exposes them. It requires explicit consent and compatible Source
2 structures. System permissions can deny access; the app does not change them.
[How the reader works and what was verified](../dev/native-reader.md).

On Wayland, always-on-top behavior depends on your desktop. Plasma asks once to
confirm the `Alt+Num 5` shortcut; change it later in **System Settings →
Shortcuts → Ancient Lens**. If it is unavailable, use the tray icon or launch the
app again to bring the window back. Borderless windowed
Dota or a second monitor is the simplest initial check.

## Native verification

```sh
npm run build
npm run test:native
npm run docs:screenshots
```

These require `WebKitWebDriver` in PATH (provided by `webkitgtk6.0` on the tested
Fedora installation), a desktop session, and no competing Ancient Lens instance.
They use temporary data and loopback fixture servers, without touching your game
configuration or notes. The smoke screenshot is `test-results/native-linux.png`;
documentation images go to `docs/images/`. Set `ANCIENT_NATIVE_BINARY` to use a
different built executable.

When reporting a problem, include Fedora version, Wayland/X11, app version, and
the error text. Remove tokens, account details, and personal paths from logs.
