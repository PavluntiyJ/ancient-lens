# Install and build

Ancient Lens is an early desktop prototype for Windows and Linux. Download a
prerelease to try it without Node.js or Rust, or build it from source. GitHub
Actions artifacts are temporary test builds, not releases.

## Download

Prereleases are on the [Releases page](https://github.com/PavluntiyJ/ancient-lens/releases).
If it lists no release yet, build from source as described below. Read the
notes of the release first: they list what is not finished yet.

| File                                    | For                                      |
| --------------------------------------- | ---------------------------------------- |
| `Ancient-Lens-<version>-x64-setup.exe`  | Windows installer                        |
| `Ancient-Lens-<version>-Tauri-win.zip`  | Windows portable build, no installation  |
| `Ancient-Lens-<version>-amd64.AppImage` | Linux, any distribution, Fedora included |
| `Ancient-Lens-<version>-amd64.deb`      | Debian and Ubuntu                        |
| `SHA256SUMS.txt`                        | SHA-256 checksums of the other files     |

**Windows.** Run the installer, or extract the complete ZIP and start
`Ancient Lens.exe`. Both need the Microsoft Edge WebView2 Runtime: Windows 11
includes it, and the installer downloads it when it is missing; for the portable
build, install it yourself if needed. The builds are not code-signed,
so SmartScreen warns about an unknown publisher: check the checksum, then choose
**More info → Run anyway**.

**Linux.** Make the AppImage executable and start it, or install the Debian
package:

```sh
chmod +x Ancient-Lens-*-amd64.AppImage
./Ancient-Lens-*-amd64.AppImage
sudo apt install ./Ancient-Lens-*-amd64.deb
```

Run the app as your regular user, never as root. Then continue with
[Connect Dota and understand your data](setup.md).

The optional STRATZ statistics service is not part of the downloads; see the
[STRATZ guide](stats-service.md). Public OpenDota profiles, notes and manual MMR
entries work without it.

### Verify the download

Download `SHA256SUMS.txt` into the same folder and compare. On Linux, this
checks every file present and reports `OK` for each:

```sh
sha256sum --check --ignore-missing SHA256SUMS.txt
```

On Windows, in PowerShell, print the hash and compare it with the line for that
file in `SHA256SUMS.txt`:

```powershell
Get-FileHash .\Ancient-Lens-0.5.0-x64-setup.exe -Algorithm SHA256
```

`Get-FileHash` prints capital letters; upper and lower case do not matter. Do
not run a file whose hash differs; download it again from the Releases page.

### Update

Install the new version over the old one. Settings, notes and rating history
live outside the program folder (see [setup](setup.md)) and are kept.

- Windows installer: quit Ancient Lens and run the new installer; it replaces
  the installed version. If it offers to remove the old version first, accept.
- Windows portable: quit Ancient Lens, then extract the new ZIP into a fresh
  folder or over the old one.
- AppImage: replace the old file with the new one and make it executable.
- Debian package: `sudo apt install ./Ancient-Lens-<version>-amd64.deb`.

There is no automatic update; watch the Releases page for new versions.

## Build from source

Building Ancient Lens yourself needs:

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

The optional STRATZ service is built separately; it is not bundled with the app.
It is not required for notes, manual MMR entries, or public OpenDota profiles.

## First use and troubleshooting

Follow [Connect Dota and understand your data](setup.md). If compilation reports
missing `webkit2gtk-4.1`, `javascriptcoregtk-4.1`, OpenSSL, or linker tools,
check the platform dependencies above. If `cargo` or `node` is not found, reopen
the terminal and verify `cargo --version` and `node --version`.

An empty match screen before GSI receives a match is expected. A working window
does not imply STRATZ is configured, and a working spectator roster does not
imply a full roster is available in your own game.
