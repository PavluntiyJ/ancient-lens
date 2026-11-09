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

`npm run dist:linux` builds AppImage, Debian and Fedora packages. Use the `.rpm`, AppImage or the
Fedora-built executable on Fedora. Temporary GitHub Actions artifacts require a
GitHub login to download; they are not published release downloads.

## Personal STRATZ service

Build the statistics service beside the app, then connect STRATZ in the app as in
the [service guide](stats-service.md#connect-stratz-in-the-app):

```sh
sudo dnf install libsecret
cargo build --release --locked --manifest-path src-tauri/Cargo.toml --no-default-features --bin stats-service
./src-tauri/target/release/ancient-lens
```

**Settings → Connections → STRATZ → Connect STRATZ** checks your token, saves it in the
desktop keyring through `secret-tool` and starts `stats-service` from
`src-tauri/target/release/` as a hidden child that stops with the app. You need a
working desktop Secret Service; there is no plaintext-file fallback. If the keyring
is locked, unlock it using your desktop. The packages (`.rpm`, AppImage) carry the
service already, so there nothing needs building.

For a menu entry for a source build, create `~/.local/share/applications/ancient-lens.desktop`
with your checkout's path:

```ini
[Desktop Entry]
Type=Application
Name=Ancient Lens
Exec="/path/to/ancient-lens/src-tauri/target/release/ancient-lens"
Icon=/path/to/ancient-lens/build/icon.svg
Terminal=false
Categories=Game;Utility;
```

To run the service yourself with a token that never enters the window, see
[Run the service yourself](stats-service.md#run-the-service-yourself-linux-or-windows).
`ANCIENT_STATS_URL` takes precedence over discovery; an empty value disables it. The
token is never passed into the desktop UI.

### From the Python launcher

Versions up to 0.9 shipped `scripts/launch-fedora.py`, which installed the
`ancient-lens-stats` user unit and a menu entry that both ran Python scripts from the
checkout. The scripts are gone; **the token it saved stays in the keyring** under the
same entry, and the app finds it. The app ignores that unit once its script is
missing and starts `stats-service` itself. To clean up the old integration:

```sh
systemctl --user disable --now ancient-lens-stats.service
rm ~/.config/systemd/user/ancient-lens-stats.service
systemctl --user daemon-reload
```

Then point `~/.local/share/applications/ancient-lens.desktop` at the binary as
above. Live-test diagnostics that `--debug` switched on are environment variables
of the app: `ANCIENT_DEBUG=1 ANCIENT_GSI_DRAFT_DIAGNOSTICS=1`. The app's own log is
in the data folder (**Settings → Data → Open log folder**).

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
