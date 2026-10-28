import type { Hero } from './domain';
import { bracketName, type RankBracket } from './rank-bracket';

import { rankedRoles, type Position } from './roles';
export type { Position } from './roles';
export type PositionStat = { heroId: number; position: string; week: number; matchCount: number; winCount: number };
export type HeroPair = {
  heroId1: number;
  heroId2: number;
  matchCount: number;
  winCount: number;
  synergy: number | null;
};
export type DraftData = {
  source: 'STRATZ';
  /** Rank bracket the statistics cover; absent from older services means all ranks. */
  bracket?: RankBracket;
  fetchedAt: string;
  positions: PositionStat[];
  matchups: { heroId: number; vs: HeroPair[]; with: HeroPair[] }[];
  /** Tests of the plain formula only: use provider pairs without shrinkage. */
  rawPairs?: boolean;
};
export type PositionSuggestion = {
  hero: Hero;
  score: number;
  base: number;
  counter: number;
  synergy: number;
  games: number;
  coverage: number;
  expected: number;
};
export const lanes: { name: string; positions: { id: Position; name: string }[] }[] = [
  { name: rankedRoles[0].name, positions: [rankedRoles[0], rankedRoles[4]] },
  { name: rankedRoles[1].name, positions: [rankedRoles[1]] },
  { name: rankedRoles[2].name, positions: [rankedRoles[2], rankedRoles[3]] },
];
/** Fewest games for a pair to count as evidence. Shrinkage already discounts small
 * samples to near zero, so this only drops pairs too sparse to say anything. */
export const MIN_PAIR_GAMES = 30;
const usable = (row?: HeroPair): row is HeroPair & { synergy: number } =>
  !!row &&
  Number.isSafeInteger(row.matchCount) &&
  Number.isSafeInteger(row.winCount) &&
  row.matchCount >= MIN_PAIR_GAMES &&
  row.winCount >= 0 &&
  row.winCount <= row.matchCount &&
  typeof row.synergy === 'number' &&
  Number.isFinite(row.synergy) &&
  row.synergy !== 666;

// Empirical-Bayes shrinkage toward zero. A pair's sampling variance is about
// 2500/n pp²; the spread of true advantages in STRATZ data (13 Oct 2026, 16k pairs)
// is ~1.9 pp² for matchups and ~1.0 pp² for synergy, so k = 2500/τ². Against an
// independent weekly matchup table the correlation rose from 0.455 to 0.524 (vs) and from
// 0.266 to 0.304 (with).
export const PAIR_SHRINKAGE = { vs: 1300, with: 2500 } as const;

/** Advantage of pair.heroId1 over (vs) or with (with) pair.heroId2 in percentage
 * points, shrunk by sample size, or undefined when the evidence is not usable.
 * Every draft view uses this. */
export function pairAdvantage(
  pair: HeroPair | undefined,
  kind: 'vs' | 'with' = 'vs',
  shrinkage: number = PAIR_SHRINKAGE[kind],
): number | undefined {
  return usable(pair) ? (pair.synergy * pair.matchCount) / (pair.matchCount + shrinkage) : undefined;
}
const shrinkageFor = (data: DraftData | undefined, kind: 'vs' | 'with') => (data?.rawPairs ? 0 : PAIR_SHRINKAGE[kind]);

export const draftLanes = [
  { id: 'all', name: 'All Lanes', title: 'All lanes', core: [1, 2, 3], support: [4, 5] },
  { id: 'safe', name: rankedRoles[0].name, title: 'Safe lane', core: [1], support: [5] },
  { id: 'off', name: rankedRoles[2].name, title: 'Off lane', core: [3], support: [4] },
  { id: 'mid', name: rankedRoles[1].name, title: 'Mid lane', core: [2], support: [] },
] as const;
export type DraftLane = (typeof draftLanes)[number];
/** Lane of an assigned position, set once from the own role: 1/5 safe, 2 mid, 3/4 off. */
export function laneForPosition(position: Position): number {
  return draftLanes.findIndex(
    (lane) => lane.id !== 'all' && ([...lane.core, ...lane.support] as readonly number[]).includes(position),
  );
}
const compareSuggestions = (a: PositionSuggestion, b: PositionSuggestion) =>
  b.score - a.score || b.coverage - a.coverage || b.games - a.games || a.hero.id - b.hero.id;

/** A position counts as the hero's own when it holds at least this share of the hero's games.
 * Below it, the few players who take the hero there are specialists, and the hero's pairs
 * describe it in its usual role (Troll Warlord mid at 7% of his games, for example). The
 * reference's curated role tables list a similar number of heroes per position. */
export const MAIN_POSITION_SHARE = 0.2;
/** Bounds of the optional minimum position win rate for suggestions. */
export const MIN_WIN_RATE = { min: 40, max: 55, initial: 50 } as const;

// STRATZ position shares decide which positions a hero is suggested for.
// A flexible hero occurs once per category, using its strongest eligible row.
// The optional minimum win rate is strict and filters rows before paging (reference rule).
export function laneSuggestions(
  rows: Record<Position, PositionSuggestion[]> | undefined,
  positions: readonly Position[],
  minWinRate?: number,
): PositionSuggestion[] {
  const sorted = positions
    .flatMap((position) => rows?.[position] ?? [])
    .filter((row) => minWinRate === undefined || row.base > minWinRate)
    .sort(compareSuggestions);
  return sorted
    .filter((row, index) => sorted.findIndex((other) => other.hero.id === row.hero.id) === index)
    .slice(0, 12);
}

// Both directed provider pairs are needed: raw win rate is not advantage.
// The sign always belongs to Radiant, regardless of the suggestions side.
export function matchupAdvantage(data: DraftData | undefined, radiant: number, dire: number): number | undefined {
  const forward = data?.matchups
    .find((row) => row.heroId === radiant)
    ?.vs.find((pair) => pair.heroId1 === radiant && pair.heroId2 === dire);
  const reverse = data?.matchups
    .find((row) => row.heroId === dire)
    ?.vs.find((pair) => pair.heroId1 === dire && pair.heroId2 === radiant);
  const a = pairAdvantage(forward, 'vs', shrinkageFor(data, 'vs')),
    b = pairAdvantage(reverse, 'vs', shrinkageFor(data, 'vs'));
  return a !== undefined && b !== undefined ? (a - b) / 2 : undefined;
}

export function meanAdvantage(values: (number | undefined)[]): number | undefined {
  const known = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : undefined;
}

/** Summed advantage of known pairs; a draft total adds up as heroes are picked. */
export function sumAdvantage(values: (number | undefined)[]): number | undefined {
  const known = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) : undefined;
}

/** Provenance line for draft surfaces: the tables are all-rank STRATZ data (D-01). */
/** One match's draft data, merged from every reply: positions from the latest reply,
 * matchups by hero. `known` lists heroes already asked for, including ones STRATZ lacks. */
export type DraftStore = { scope: string; known: number[]; data: DraftData };
export function mergeDraft(store: DraftStore | undefined, scope: string, ids: number[], reply: DraftData): DraftStore {
  const base = store?.scope === scope ? store : undefined;
  const matchups = new Map((base?.data.matchups ?? []).map((row) => [row.heroId, row]));
  for (const row of reply.matchups) matchups.set(row.heroId, row);
  // The combined data is as old as its oldest reply.
  const fetchedAt =
    base && Date.parse(base.data.fetchedAt) < Date.parse(reply.fetchedAt) ? base.data.fetchedAt : reply.fetchedAt;
  return {
    scope,
    known: [...new Set([...(base?.known ?? []), ...ids])],
    data: { ...reply, fetchedAt, matchups: [...matchups.values()] },
  };
}
/** Heroes the match's store has not asked for yet. */
export function missingDraftIds(store: DraftStore | undefined, scope: string, ids: number[]): number[] {
  const known = new Set(store?.scope === scope ? store.known : []);
  return ids.filter((id) => !known.has(id));
}

/** Every valid hero in service-sized batches; requesting them once warms the service cache. */
export function draftWarmBatches(heroes: { id: number }[]): number[][] {
  const ids = [...new Set(heroes.map((hero) => hero.id))].filter((id) => Number.isInteger(id) && id > 0 && id <= 1000);
  const batches: number[][] = [];
  for (let i = 0; i < ids.length; i += 10) batches.push(ids.slice(i, i + 10));
  return batches;
}

export function draftDataNote(data: Pick<DraftData, 'fetchedAt' | 'bracket'> | undefined): string {
  const at = data?.fetchedAt ? new Date(data.fetchedAt) : undefined;
  const updated =
    at && Number.isFinite(at.getTime())
      ? ` · updated ${at.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`
      : '';
  const ranks = data?.bracket && data.bracket !== 'ALL' ? bracketName(data.bracket) : 'all ranks';
  return `STRATZ, ${ranks}${updated}`;
}

/** Below this, a matrix pair is drawn grey and described as even. */
export const MATCHUP_EVEN = 0.2;
const TINT = { neutral: [115, 115, 115], radiant: [34, 197, 94], dire: [239, 68, 68] } as const;
/** Reference-style cell tint: the winner's team colour, greyer near zero and fully saturated
 * from 1.8 points (real shrunk pairs are mostly 0.2–2). Below 0.2 the cell is plain grey. */
export function matchupTint(value: number) {
  const tone: 'radiant' | 'dire' | 'neutral' = value > 0 ? 'radiant' : value < 0 ? 'dire' : 'neutral';
  const strength = Math.min(1, Math.max(0, (Math.abs(value) - MATCHUP_EVEN) / 1.6));
  const target = TINT[tone];
  const rgb = TINT.neutral.map((grey, i) => Math.round(grey + (target[i]! - grey) * strength));
  return { tone: strength === 0 ? ('neutral' as const) : tone, rgb: rgb.join(', '), strength };
}

// Greying |x| < 2 on a raw weekly table would colour only about 16% of pairs.
// Shrunk estimates are smaller, so 1.5 keeps a comparable share (~14%).
export const NEUTRAL_ADVANTAGE = 1.5;
export function advantageTone(value: number | undefined) {
  const strength = value === undefined ? 0 : Math.abs(value);
  return {
    tone: strength < NEUTRAL_ADVANTAGE ? 'neutral' : value! > 0 ? 'radiant' : 'dire',
    intensity: strength < NEUTRAL_ADVANTAGE ? 0 : Math.min(0.78, 0.2 + strength * 0.055),
  };
}

// Score: mean matchup + weighted mean synergy; position win rate is not added.
// Win rate is displayed separately, not added to advantage. The provider tables
// and position eligibility remain STRATZ-based, so this is not numerical parity.
export function scorePositions(
  heroes: Hero[],
  data: DraftData,
  allies: number[],
  enemies: number[],
  bans: number[] = [],
  synergyWeight = 50,
  confirmed: number[] = [...allies, ...enemies],
): Record<Position, PositionSuggestion[]> {
  const result: Record<Position, PositionSuggestion[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  allies = [...new Set(allies)];
  enemies = [...new Set(enemies)];
  const weight = Number.isFinite(synergyWeight) ? Math.max(0, Math.min(100, synergyWeight)) / 100 : 0.5;
  if (!enemies.length && (!allies.length || !weight)) return result;
  const excluded = new Set([...confirmed, ...bans]);
  const totals = new Map<number, number>();
  for (const row of data.positions)
    if (row.matchCount > 0 && Number.isFinite(row.matchCount))
      totals.set(row.heroId, (totals.get(row.heroId) ?? 0) + row.matchCount);
  const eligible = data.positions.filter(
    (row) =>
      result[Number(row.position.replace('POSITION_', '')) as Position] &&
      row.matchCount >= 200 &&
      row.winCount >= 0 &&
      row.winCount <= row.matchCount &&
      row.matchCount / (totals.get(row.heroId) || 1) >= MAIN_POSITION_SHARE,
  );
  const roles = new Map<number, Set<string>>();
  for (const row of eligible) {
    const positions = roles.get(row.heroId) ?? new Set();
    positions.add(row.position);
    roles.set(row.heroId, positions);
  }
  const roundPair = (value: number) => (Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100)) / 100;
  for (const row of eligible) {
    const position = Number(row.position.replace('POSITION_', '')) as Position;
    const hero = heroes.find((h) => h.id === row.heroId);
    if (!hero || excluded.has(hero.id)) continue;
    // A hovered candidate may remain available; it has no pair with itself.
    const enemyIds = enemies.filter((id) => id !== hero.id),
      allyIds = allies.filter((id) => id !== hero.id);
    const evidence = (field: 'vs' | 'with', ids: number[]) =>
      ids.flatMap((id) => {
        const value = pairAdvantage(
          data.matchups.find((r) => r.heroId === id)?.[field].find((p) => p.heroId1 === id && p.heroId2 === hero.id),
          field,
          shrinkageFor(data, field),
        );
        return value === undefined ? [] : [{ heroId1: id, value }];
      });
    const against = evidence('vs', enemyIds);
    const together = weight ? evidence('with', allyIds) : [];
    if (!against.length && !together.length) continue;
    // Pairs are fetched from the picked hero's perspective; invert enemy advantage.
    // Unknown pairs contribute zero while the divisor stays the full team size.
    const counter = enemyIds.length ? -against.reduce((sum, pair) => sum + pair.value, 0) / enemyIds.length : 0;
    const synergy = allyIds.length
      ? together.reduce((sum, pair) => {
          const candidateRoles = roles.get(hero.id),
            allyRoles = roles.get(pair.heroId1);
          const conflict =
            candidateRoles?.size === 1 && allyRoles?.size === 1 && [...candidateRoles][0] === [...allyRoles][0];
          return sum + roundPair(pair.value * weight) - (conflict ? 100 : 0);
        }, 0) / allyIds.length
      : 0;
    const base = (row.winCount / row.matchCount) * 100;
    result[position].push({
      hero,
      base,
      counter,
      synergy,
      score: counter + synergy,
      games: row.matchCount,
      coverage: against.length + together.length,
      expected: enemyIds.length + (weight ? allyIds.length : 0),
    });
  }
  for (const rows of Object.values(result)) rows.sort(compareSuggestions);
  return result;
}
