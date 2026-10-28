# Install and build

Ancient Lens 0.5.0 is an early desktop prototype for Windows and Linux. There is
no published release binary yet. GitHub Actions artifacts are temporary test
builds, not releases; the supported starting point is a source build.

## Requirements

- Git, Node.js 22.12+, npm, and Rust stable installed through rustup.
- Windows: MSVC C++ Build Tools with the Windows SDK, and Microsoft Edge WebView2
  Runtime. Use PowerShell or a developer terminal; do not build the Windows app in WSL.
- Linux: a desktop session and WebKitGTK 4.1 development libraries.

The [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) describe the
platform toolchains. Restart your terminal after installing them.

### Ubuntu / Debian

```sh
sudo apt update
sudo apt install build-essential pkg-config libwebkit2gtk-4.1-dev \
  libssl-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev \
  curl wget file git
```

Install Node.js and Rust separately if your distribution packages are older than
the required versions. For Fedora, use the [Fedora guide](fedora.md).

## Source build

```sh
git clone https://github.com/PavluntiyJ/ancient-lens.git
cd ancient-lens
npm ci
npm run dev
```

If you downloaded a source ZIP, extract it first, open a terminal in the folder
containing `package.json`, and start with `npm ci`. No personal settings or
research archive is needed. The `release/` source snapshot intentionally has no
Git history; its `SOURCE-MANIFEST.json` lists file checksums.

The first Rust compilation can take several minutes. `npm run dev` builds the
frontend and launches Tauri. Frontend changes require rebuilding/restarting;
this command does not start a Vite hot-reload server.

```sh
npm run build
```

The optimized executable is `src-tauri/target/release/ancient-lens` on Linux,
or `src-tauri/target/release/ancient-lens.exe` on Windows. Run it as your regular
user, with the same permissions as Dota. Do not run the app as root.

## Packages

Build packages on the target platform:

| Command                | Output                                                       |
| ---------------------- | ------------------------------------------------------------ |
| `npm run dist:linux`   | AppImage and `.deb` under `src-tauri/target/release/bundle/` |
| `npm run dist:win`     | NSIS installer under `src-tauri/target/release/bundle/nsis/` |
| `npm run dist:win:zip` | Portable ZIP under `release/`                                |

On Fedora, use the native executable or AppImage, not the Debian package. Make
an AppImage executable before launching it (`chmod +x <download>.AppImage`).
If AppImage/FUSE is unavailable, use the native build. Windows portable builds
require an installed WebView2 Runtime. Packages are currently unsigned.

The optional STRATZ service is a separate binary that you build yourself (see the
[statistics service guide](stats-service.md)). The NSIS installer and the Linux packages
never contain it. `npm run dist:win:zip` copies `stats-service.exe` into the portable ZIP
only when it was built in `src-tauri/target/release/` beforehand; CI builds do not do that
yet ([#2](https://github.com/PavluntiyJ/ancient-lens/issues/2)). On Windows the app starts
the service itself when the binary sits next to `ancient-lens.exe` and a token is saved.
The service is not required for notes, manual MMR entries, or public OpenDota profiles.

## First use and troubleshooting

Follow [Connect Dota and understand your data](setup.md). If compilation reports
missing `webkit2gtk-4.1`, `javascriptcoregtk-4.1`, OpenSSL, or linker tools,
check the platform dependencies above. If `cargo` or `node` is not found, reopen
the terminal and verify `cargo --version` and `node --version`.

An empty match screen before GSI receives a match is expected. A working window
does not imply STRATZ is configured, and a working spectator roster does not
imply a full roster is available in your own game.
