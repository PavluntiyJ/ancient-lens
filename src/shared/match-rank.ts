import type { LineupEntry, Match } from './domain';

/** Statistics a match card can rank across the ten players. */
export type RankField =
  | 'kills'
  | 'deaths'
  | 'assists'
  | 'last_hits'
  | 'denies'
  | 'gold_per_min'
  | 'xp_per_min'
  | 'net_worth'
  | 'hero_damage'
  | 'tower_damage'
  | 'hero_healing'
  | 'imp'
  | 'kp'
  | 'dp';
export type RankRow = { entry: LineupEntry; value?: number; place?: number };
export type Ranking = {
  rows: RankRow[];
  /** Range of the known values, for bars; IMP can be negative. */
  min: number;
  max: number;
  lowerIsBetter: boolean;
  /** The own player's place among the players with a value. */
  own?: { place: number; of: number };
};

const lowerIsBetter = new Set<RankField>(['deaths', 'dp']);

/** Kills and deaths of each side, when all five players of that side report both. */
function teamTotals(lineup: LineupEntry[]) {
  const totals = new Map<boolean, { kills: number; deaths: number }>();
  for (const radiant of [true, false]) {
    const team = lineup.filter((entry) => entry.radiant === radiant);
    if (team.length !== 5 || team.some((entry) => entry.kills === undefined || entry.deaths === undefined)) continue;
    totals.set(radiant, {
      kills: team.reduce((sum, entry) => sum + entry.kills!, 0),
      deaths: team.reduce((sum, entry) => sum + entry.deaths!, 0),
    });
  }
  return totals;
}

/**
 * The players of a match ordered by one statistic, best first (deaths and death
 * participation lower first). Equal values share a place, the own row first among them;
 * players without a value come last without a place. KP and DP use each side's own total.
 */
export function matchRanking(match: Match, field: RankField): Ranking | undefined {
  const lineup = match.lineup;
  if (!lineup?.length) return undefined;
  const totals = teamTotals(lineup);
  const valueOf = (entry: LineupEntry) => {
    if (field === 'kp' || field === 'dp') {
      const team = totals.get(entry.radiant);
      if (!team || entry.kills === undefined || entry.deaths === undefined) return undefined;
      if (field === 'dp') return (entry.deaths / Math.max(team.deaths, 1)) * 100;
      if (entry.assists === undefined) return undefined;
      return Math.min(100, ((entry.kills + entry.assists) / Math.max(team.kills, 1)) * 100);
    }
    return entry[field];
  };
  const lower = lowerIsBetter.has(field);
  const rows: RankRow[] = lineup.map((entry) => ({ entry, value: valueOf(entry) }));
  rows.sort((a, b) => {
    if (a.value === undefined || b.value === undefined)
      return Number(a.value === undefined) - Number(b.value === undefined);
    const order = lower ? a.value - b.value : b.value - a.value;
    return order || Number(Boolean(b.entry.own)) - Number(Boolean(a.entry.own));
  });
  const known = rows.filter((row) => row.value !== undefined);
  known.forEach((row, index) => {
    const previous = known[index - 1];
    row.place = previous && previous.value === row.value ? previous.place : index + 1;
  });
  const values = known.map((row) => row.value!);
  const own = known.find((row) => row.entry.own);
  return {
    rows,
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
    lowerIsBetter: lower,
    own: own ? { place: own.place!, of: known.length } : undefined,
  };
}
