# Dota 2 ranked role icons

Original Valve assets extracted from the locally installed Dota 2 on 2026-10-13
(ClientVersion 6958, SourceRevision 11119297). Source archive: `game/dota/pak01_dir.vpk`.

Each PNG comes from `panorama/images/rank_tier_icons/handicap/`:

| Local file | Archive resource |
| --- | --- |
| safelane.png | safelaneicon_psd.vtex_c |
| midlane.png | midlaneicon_psd.vtex_c |
| offlane.png | offlaneicon_psd.vtex_c |
| softsupport.png | softsupporticon_psd.vtex_c |
| hardsupport.png | hardsupporticon_psd.vtex_c |

Exported to 100 × 100 RGBA PNG with Source 2 Viewer CLI 20.0, with no redrawing,
resizing or recoloring. The application bundles them locally for offline use.

Reproduction (substitute the game directory and role file name):

```sh
Source2Viewer-CLI -i '/path/to/dota/game/dota/pak01_dir.vpk' \
  -f 'panorama/images/rank_tier_icons/handicap/safelaneicon_psd.vtex_c' \
  -d -o public/roles/safelane.png
```

Tool: https://github.com/ValveResourceFormat/ValveResourceFormat/releases/tag/20.0

These game assets belong to Valve and are not covered by Ancient Lens's MIT
license. Their use here does not imply Valve affiliation or endorsement.
