# Security

Ancient Lens is an early prototype. The current development branch is the
supported place for fixes; there is no long-term support policy for older builds.

To report a vulnerability, open a
[private security advisory](https://github.com/PavluntiyJ/ancient-lens/security/advisories/new)
on this repository's **Security** tab. Do not put exploit details, tokens, personal
captures, or credentials in a public issue. No dedicated security email address or
guaranteed response time is currently advertised.

Never attach `state.json`, a generated GSI configuration, keyring contents, a
personal export, raw account captures, or environment dumps to a public report.
Describe the affected version, platform, expected behavior, and a minimal
reproduction using synthetic data. A leaked token must be revoked at its issuer;
removing the current file does not remove it from Git history or existing clones.

The app's GSI receiver binds only to loopback and uses a per-installation secret.
The personal statistics service also defaults to loopback and keeps its upstream
token outside the desktop UI. Do not publish either port directly. Memory reading
is opt-in and read-only; compatibility and the anti-cheat response are not
promised. See [setup](docs/guide/setup.md) for the actual data flows.
