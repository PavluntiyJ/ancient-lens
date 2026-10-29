## Before you install

This is an early prerelease. Read these points first:

- **Unsigned Windows build.** The installer and the portable app are not code-signed, so
  Windows SmartScreen warns that the publisher is unknown. Compare the file with
  `SHA256SUMS.txt` first, then choose **More info → Run anyway**. The portable ZIP needs the
  Microsoft Edge WebView2 Runtime.
- **Memory reader off by default.** The optional reader is read-only and stays off until you
  turn it on in Settings. How Valve's anti-cheat responds to it is unknown; turn it on only if
  you accept that risk. See [safety and fair play](https://github.com/PavluntiyJ/ancient-lens/blob/main/docs/guide/fair-play.md).
- **STRATZ features need your own STRATZ token.** Press **Connect STRATZ** in Settings and
  paste it; every download includes the statistics service it starts
  ([setup](https://github.com/PavluntiyJ/ancient-lens/blob/main/docs/guide/stats-service.md)).
  Public OpenDota profiles, notes and manual MMR work without it.

## Files

| File                                    | For                                       |
| --------------------------------------- | ----------------------------------------- |
| `Ancient-Lens-<version>-x64-setup.exe`  | Windows installer                         |
| `Ancient-Lens-<version>-Tauri-win.zip`  | Windows portable build                    |
| `Ancient-Lens-<version>-amd64.AppImage` | Linux, any distribution (Fedora included) |
| `Ancient-Lens-<version>-amd64.deb`      | Debian and Ubuntu                         |
| `SHA256SUMS.txt`                        | Checksums of the files above              |

Installing, verifying and updating are described in the
[installation guide](https://github.com/PavluntiyJ/ancient-lens/blob/main/docs/guide/install.md#download).
