# Release preparation

Releases are unsigned prereleases for Windows and Linux. Prepare a release in a branch and
pull request linked to an issue, after the changes it includes have been reviewed. Do not tag
a branch that still depends on an unmerged feature pull request.

## Version and documentation

Use the same version in all six places:

- `package.json` and the root package entries in `package-lock.json`;
- `src-tauri/Cargo.toml` and the `ancient-lens` entry in `src-tauri/Cargo.lock`;
- `src-tauri/tauri.conf.json`;
- the prototype version in `README.md`.

Keep an empty `Unreleased` section in `CHANGELOG.md` and move the included changes under a
dated version heading. Update the affected user guides and installation filename example.
The workflow takes the release's changes from that changelog section and adds the common
installation notes from `.github/release-notes.md`.

Close competing Ancient Lens windows, then regenerate the documentation images from the
built app with isolated invented data:

```sh
npm ci
npm run build
npm run docs:screenshots
```

Inspect every changed image for clipping, missing portraits, stale controls and readable
text. Commit the images with the documentation. CI does not regenerate or commit them.
`npm run demo` is available for a broader interactive review on awkward fictional data.
Never use personal notes, account captures, Steam settings or a live game as release fixtures.

## Verification

Run the applicable [contribution checks](../../CONTRIBUTING.md#checks), including
`npm run test:native` against the built app. Record the operating system, results and skipped
checks in the release pull request. Windows and Linux have equal status: CI runs ordinary
checks on both, but a Linux native desktop check still needs a reachable Linux desktop. A
green unit-test job alone does not establish Linux desktop behavior. Follow the platform rule
when a change has a platform gap, and keep the README platform table and `docs/status.md`
accurate.

## Draft and publication

After the included feature and release-preparation pull requests have merged, fetch `main`
and confirm that its version files and changelog match the intended tag. For 0.7.0:

```sh
git fetch origin
git tag -a v0.7.0 origin/main -m "Ancient Lens 0.7.0"
git push origin v0.7.0
```

The [build workflow](../../.github/workflows/build.yml) checks both platforms, builds their
packages and checks that the statistics service is bundled. Windows also runs the native
smoke scenario. Only after these jobs pass does the workflow create a **draft prerelease**
with the packages and `SHA256SUMS.txt`. A manual workflow run builds temporary artifacts but
does not create a release.

Review the draft's version, notes, Windows installer and portable ZIP, Linux AppImage, Debian
and Fedora packages, and checksums. Publish the draft from GitHub Releases when it is ready.
The app's update notice ignores drafts and only announces a newer published release; it does
not download or install an update.
