import { z } from 'zod';
import type { LiveState } from './domain';
import { visibleDraftPicks, visibleDraftSlots } from './live-draft';

/** Matches `SAMPLE_DAYS` in `src-tauri/src/item_stats.rs`. */
const SAMPLE_DAYS = 365;

const integer = z.number().int().min(0).max(2000);
const counts = z.object({ games: integer, wins: integer, withGames: integer, withWins: integer });
const equipmentSchema = z.object({
  itemId: z.number().int().min(1).max(10000),
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_]+$/),
  label: z.string().min(1).max(150),
  cost: z.number().int().min(1000).max(100000),
});
const itemSchema = counts.extend(equipmentSchema.shape);
const pairSchema = counts.extend({
  itemId: z.number().int().min(1).max(10000),
  otherHeroId: z.number().int().min(1).max(1000),
  relation: z.enum(['enemy', 'ally']),
});
const schema = z.object({
  heroId: z.number().int().min(1).max(1000),
  sampleMatches: integer,
  standardBuilds: z
    .array(z.object({ items: z.array(equipmentSchema).min(5).max(6), matches: integer.min(1), wins: integer }))
    .max(3),
  oldest: z.number().int().positive().nullable(),
  newest: z.number().int().positive().nullable(),
  items: z.array(itemSchema).max(24),
  pairs: z.array(pairSchema).max(48000),
  source: z.literal('OpenDota Explorer'),
  fetchedAt: z.string().datetime({ offset: true }),
  stale: z.boolean(),
  demonstration: z.boolean(),
});
export type ItemCounts = z.infer<typeof counts>;
export type ItemData = z.infer<typeof schema>;
export type ItemContext = { heroId: number; enemies: number[]; allies: number[] };
export type ItemEvidence = {
  heroId: number;
  relation: 'enemy' | 'ally';
  withGames: number;
  withoutGames: number;
  withWinRate: number;
  withoutWinRate: number;
  adjustment: number;
};
export type ItemOption = {
  item: ItemData['items'][number];
  score: number;
  enemy: number;
  ally: number;
  enemyCoverage: number;
  evidence: ItemEvidence[];
};

function validCounts(row: ItemCounts) {
  return (
    row.wins <= row.games &&
    row.withGames <= row.games &&
    row.withWins <= row.withGames &&
    row.withWins <= row.wins &&
    row.wins - row.withWins <= row.games - row.withGames
  );
}
function remainder(total: ItemCounts, part: ItemCounts): ItemCounts {
  return {
    games: total.games - part.games,
    wins: total.wins - part.wins,
    withGames: total.withGames - part.withGames,
    withWins: total.withWins - part.withWins,
  };
}
export function parseItemData(raw: unknown, heroId: number): ItemData {
  const data = schema.parse(raw);
  const invalid = () => {
    throw new Error('Invalid item statistics');
  };
  if (data.heroId !== heroId) invalid();
  if (data.sampleMatches === 0) {
    if (data.oldest !== null || data.newest !== null || data.items.length) invalid();
  } else if (
    data.oldest === null ||
    data.newest === null ||
    data.oldest > data.newest ||
    data.newest - data.oldest > SAMPLE_DAYS * 86400
  )
    invalid();
  const ids = new Set<number>();
  let buildMatches = 0;
  let previous = data.sampleMatches;
  const builds = new Set<string>();
  for (const [index, build] of data.standardBuilds.entries()) {
    const ids = build.items.map((item) => item.itemId).sort((a, b) => a - b);
    const key = ids.join(',');
    buildMatches += build.matches;
    if (
      new Set(ids).size !== ids.length ||
      builds.has(key) ||
      build.wins > build.matches ||
      buildMatches > data.sampleMatches ||
      build.matches > previous ||
      (index > 0 && build.matches < 2)
    )
      invalid();
    builds.add(key);
    previous = build.matches;
  }
  for (const item of data.items) {
    if (ids.has(item.itemId) || !validCounts(item) || item.games !== data.sampleMatches) invalid();
    ids.add(item.itemId);
  }
  const keys = new Set<string>();
  for (const pair of data.pairs) {
    const total = data.items.find((i) => i.itemId === pair.itemId);
    const key = `${pair.itemId}-${pair.relation}-${pair.otherHeroId}`;
    if (!total || keys.has(key) || pair.otherHeroId === heroId || !validCounts(pair)) invalid();
    if (total) {
      const rest = remainder(total, pair);
      if (Object.values(rest).some((n) => n < 0) || !validCounts(rest)) invalid();
    }
    keys.add(key);
  }
  return data;
}

/** Use confirmed, already-visible picks only; a hover never becomes an owned hero. */
export function itemContext(
  live: LiveState,
  ownId: string,
  connected: boolean,
  now = Date.now(),
): ItemContext | undefined {
  if (live.mode !== 'player') return undefined;
  const self = live.players?.filter((p) => p.key === 'self' || (!!ownId && p.accountId === ownId));
  if (self?.length !== 1) return undefined;
  const player = self[0]!;
  const picks = visibleDraftPicks(live, connected, now);
  const slots = visibleDraftSlots(live, connected, now)[player.team].filter((s) => s.isSelf);
  const heroId = slots.length === 1 ? (slots[0]!.pick ?? player.heroId) : player.heroId;
  if (!heroId || !picks.some((p) => p.team === player.team && p.heroId === heroId)) return undefined;
  return {
    heroId,
    allies: picks.filter((p) => p.team === player.team && p.heroId !== heroId).map((p) => p.heroId),
    enemies: picks.filter((p) => p.team !== player.team).map((p) => p.heroId),
  };
}

// Every cell needs both purchase groups. Missing groups are unavailable, not a 0% WR.
const MIN_GROUP = 10;
function contrast(row: ItemCounts): number | undefined {
  const without = row.games - row.withGames;
  if (row.withGames < MIN_GROUP || without < MIN_GROUP) return undefined;
  return row.withWins / row.withGames - (row.wins - row.withWins) / without;
}

/** Difference of purchase contrasts inside/outside the matchup, shrunk for sparse cells.
 * This adjusts for a generally winning item but still is observational, not causal uplift.
 */
export function rankItems(data: ItemData, context: ItemContext): ItemOption[] {
  if (data.heroId !== context.heroId || !context.enemies.length) return [];
  const enemies = [...new Set(context.enemies)];
  const allies = [...new Set(context.allies)];
  const options: ItemOption[] = [];
  for (const item of data.items) {
    const evidence: ItemEvidence[] = [];
    for (const pair of data.pairs.filter((p) => p.itemId === item.itemId)) {
      if (!(pair.relation === 'enemy' ? enemies : allies).includes(pair.otherHeroId)) continue;
      const outside = remainder(item, pair);
      const insideContrast = contrast(pair);
      const outsideContrast = contrast(outside);
      if (insideContrast === undefined || outsideContrast === undefined) continue;
      const support = Math.min(
        pair.withGames,
        pair.games - pair.withGames,
        outside.withGames,
        outside.games - outside.withGames,
      );
      evidence.push({
        heroId: pair.otherHeroId,
        relation: pair.relation,
        withGames: pair.withGames,
        withoutGames: pair.games - pair.withGames,
        withWinRate: (100 * pair.withWins) / pair.withGames,
        withoutWinRate: (100 * (pair.wins - pair.withWins)) / (pair.games - pair.withGames),
        adjustment: (100 * (insideContrast - outsideContrast) * support) / (support + 50),
      });
    }
    const enemyRows = evidence.filter((p) => p.relation === 'enemy');
    if (!enemyRows.length) continue;
    // Divide by ALL known picks, so a single measured pair is not presented as full coverage.
    const enemy = enemyRows.reduce((sum, p) => sum + p.adjustment, 0) / enemies.length;
    const allyRaw = allies.length
      ? (evidence.filter((p) => p.relation === 'ally').reduce((sum, p) => sum + p.adjustment, 0) / allies.length) * 0.5
      : 0;
    // Apply both the 50% per-team weight and an absolute aggregate cap: allies cannot
    // create an enemy recommendation or reverse the enemy signal.
    const cap = Math.abs(enemy) * 0.5;
    const ally = Math.max(-cap, Math.min(cap, allyRaw));
    if (enemy > 0 && enemy + ally > 0)
      options.push({
        item,
        score: enemy + ally,
        enemy,
        ally,
        enemyCoverage: enemyRows.length,
        evidence: evidence.sort((a, b) =>
          a.relation === b.relation ? b.adjustment - a.adjustment : a.relation === 'enemy' ? -1 : 1,
        ),
      });
  }
  return options.sort(
    (a, b) => b.score - a.score || b.enemyCoverage - a.enemyCoverage || a.item.itemId - b.item.itemId,
  );
}
