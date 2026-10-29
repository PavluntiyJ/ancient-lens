# What the draft numbers mean

## Pick recommendations

STRATZ supplies hero position statistics and directed hero pairs (against and
with allies) for its published week, for one rank bracket (see
[Limitations](#limitations)). Candidates are scored as:

```text
score = mean advantage against known opponents
      + synergy weight × mean advantage with known allies
```

The default synergy weight is 50%. Change it in **Settings → Match statistics**
(steps of 5%); it re-scores loaded data without fetching again. Without the
STRATZ service the slider is disabled, since there are no suggestions to weigh.

- A hero qualifies for a position with at least 200 matches and at least a 20%
  share of that hero's games, the same main positions as Meta picks. Below that
  share the hero's pairs describe its usual role (Troll Warlord mid is 7% of his
  games). Pairs need at least 30 matches; empirical-Bayes
  shrinkage pulls small samples toward zero (`n / (n + 1300)` against,
  `n / (n + 2500)` with allies).
- Missing pairs contribute zero but remain in the team denominator.
- Position win rate is shown separately in the tooltip; it is not added to the score.
  The score sorts by advantage alone, so a hero who is weak overall can lead when it
  does well against these opponents.
- **Settings → Match statistics → Minimum hero win rate for suggestions** (off by
  default, 40–55%, initially 50%) hides candidates whose win rate in that position
  is not above the threshold, before paging. A flexible hero can remain with
  another position of the lane.
- Picked and banned heroes are excluded. A hovered, unconfirmed hero remains a
  candidate and is included in the tentative draft separately.
- The lane is shared by both panels (`Alt+↑/↓`). In your own match the assigned
  position sets it once: 1/5 → Safe, 2 → Mid, 3/4 → Off. A manual lane choice for
  that match is preserved.
- Your side is labelled **your team**.
- Core/Support groups and lanes use eligible STRATZ positions. A flexible hero
  can appear in both groups. This grouping is our adaptation.

## Matchup matrix

Rows are Radiant, columns are Dire. A pair value is half the difference between
the two directed advantages. Each cell shows the portrait of the hero who wins the
pair, tinted green for Radiant and red for Dire; the colour gets richer up to
1.8 points, and pairs below 0.2 points stay grey. Each hero shows the sum over its
known pairs from its own side, and the corner shows the draft total. Hovering a
cell opens its card. Values are advantage in percentage points, **not win
probabilities**. A dash means a valid pair is unavailable.

## Lanes

The **Lanes** page pairs the lanes: Radiant safe lane (positions 1 and 5) against
Dire off lane (3 and 4), mid against mid, and Radiant off lane against Dire safe
lane. Each hero sits at this match's role: a lane selected in the draft, or the
team-wide guess, shown with a dimmed role icon. A lane's value is the sum of the
matchup pairs of its heroes, for Radiant or Dire; it stays a dash until every hero
of that lane is known. The footer gives the counter total (all Radiant–Dire pairs),
synergy (Radiant ally pairs minus Dire ally pairs) and their total with synergy at
the configured weight.

## Counter picks and meta

Counter picks are the ten best candidates against each hero on the selected side.
A blue outline marks candidates in the top ten against at least two opponents.

Meta picks list six heroes per position. A position counts only when it holds at
least 20% of the hero's games and has at least 200 games. Heroes are ranked by a
sample-adjusted win rate (shrunk toward 50% with 290 virtual games); the raw rate
is shown. Picked heroes drop out; banned heroes keep their place, struck through.

## Limitations

Statistics come from one STRATZ rank bracket per match. By default it follows the
match: the median medal once at least three players' medals are known, otherwise your
own medal (or rating), otherwise all ranks; **Settings → Match statistics** can fix a
bracket instead. STRATZ groups Immortal with Divine. Patch is not filtered: the data is
STRATZ's published week. Predictive quality has not been measured.

## Manual draft

Open it from the match screen while no game data arrives (**Manual draft**). The manual tool
uses OpenDota `GET /heroes/{enemy}/matchups`. Results are inverted
because the API describes the opponent's wins, then smoothed with 100 virtual
50%-win-rate matches. Pairs below 30 observations are excluded.

```text
pair = (games_played − enemy_wins + 50) / (games_played + 100)
index = 100 × average(pair)
```

This view does not account for synergy, positions, patch, or rank.
