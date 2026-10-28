import { useEffect, useState } from 'react';
import type { HeroAverageRow, HeroAverages, Match } from '../../shared/domain';
import type { RankBracket } from '../../shared/rank-bracket';
import { matchBracket } from '../../shared/stat-bands';

export type AverageBatch = { bracket: RankBracket; ids: number[] };
type Fetch = (ids: number[], bracket: RankBracket) => Promise<HeroAverages>;

/** Rows per `bracket:hero` for the session; an empty list is a known gap (failed or none). */
const cache = new Map<string, HeroAverageRow[]>();
const pending = new Set<string>();
const key = (heroId: number, bracket: RankBracket) => `${bracket}:${heroId}`;

/** Heroes of the matches grouped by the bracket of each match, at most ten per request. */
export function averageBatches(matches: Match[]): AverageBatch[] {
  const heroes = new Map<RankBracket, number[]>();
  for (const match of matches) {
    const bracket = matchBracket(match);
    if (!bracket) continue;
    const ids = heroes.get(bracket) ?? [];
    if (!ids.includes(match.hero_id)) ids.push(match.hero_id);
    heroes.set(bracket, ids);
  }
  return [...heroes].flatMap(([bracket, ids]) =>
    Array.from({ length: Math.ceil(ids.length / 10) }, (_, i) => ({ bracket, ids: ids.slice(i * 10, i * 10 + 10) })),
  );
}

export function cachedAverages(heroId: number, bracket: RankBracket): HeroAverageRow[] | undefined {
  return cache.get(key(heroId, bracket));
}

/** Loads the heroes of a batch that are neither cached nor already being loaded. A failure is
 * remembered as "no rows" so the page does not ask again on every render. */
export async function loadBatch(batch: AverageBatch, fetch: Fetch): Promise<void> {
  const ids = batch.ids.filter((id) => !cache.has(key(id, batch.bracket)) && !pending.has(key(id, batch.bracket)));
  if (!ids.length) return;
  ids.forEach((id) => pending.add(key(id, batch.bracket)));
  const result = await fetch(ids, batch.bracket).catch(() => undefined);
  for (const id of ids) {
    cache.set(key(id, batch.bracket), result?.rows.filter((row) => row.heroId === id) ?? []);
    pending.delete(key(id, batch.bracket));
  }
}

/** Averages for the heroes of the given (visible) matches; re-renders as batches arrive. */
export function useHeroAverages(
  matches: Match[],
  fetch: Fetch | undefined,
): (heroId: number, bracket: RankBracket) => HeroAverageRow[] | undefined {
  const [, setLoaded] = useState(0);
  const batches = JSON.stringify(averageBatches(matches));
  useEffect(() => {
    if (!fetch) return;
    let active = true;
    for (const batch of JSON.parse(batches) as AverageBatch[])
      void loadBatch(batch, fetch).then(() => active && setLoaded((n) => n + 1));
    return () => {
      active = false;
    };
  }, [batches, fetch]);
  return cachedAverages;
}
