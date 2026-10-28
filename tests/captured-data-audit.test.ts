import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  MAIN_POSITION_SHARE,
  MIN_PAIR_GAMES,
  matchupAdvantage,
  pairAdvantage,
  scorePositions,
  type DraftData,
} from '../src/shared/draft';
import { counterPicks } from '../src/shared/counter-picks';
import { metaPicks } from '../src/shared/meta-picks';
import { averageKda, filterHistory } from '../src/shared/history';
import { matchWon, type Hero, type PlayerHistory, type PlayerSummary } from '../src/shared/domain';

// Opt-in replay of captured public responses; ordinary tests never contact providers.
const directory = process.env.ANCIENT_AUDIT_DATA;
const audit = it.skipIf(!directory);
function read<T>(name: string): T {
  if (!directory) throw new Error('ANCIENT_AUDIT_DATA required');
  return JSON.parse(readFileSync(join(directory, name), 'utf8')) as T;
}
type Captures = {
  timestamp: number;
  summaries: (PlayerSummary & { filter: { mode: string; rankedOnly: boolean } })[];
  histories: PlayerHistory[];
  drafts: DraftData[];
};
type RawMatch = {
  id: number;
  endDateTime: number;
  durationSeconds: number;
  didRadiantWin: boolean | null;
  gameMode: string;
  lobbyType: string;
  players: { steamAccountId: number; heroId: number; isRadiant: boolean }[];
};
type RawPlayer = { steamAccountId: number; matches: RawMatch[] };

audit('compares every Rust summary to independently counted public matches', () => {
  const capture = read<Captures>('normalized.json');
  const players = readdirSync(directory ?? '')
    .filter((name) => /^(public-)?players-\d+\.json$/.test(name))
    .flatMap((name) => read<{ data: { players: RawPlayer[] } }>(name).data.players);
  for (const summary of capture.summaries) {
    const raw = players.find((row) => String(row.steamAccountId) === summary.accountId);
    expect(raw).toBeDefined();
    const allowed =
      summary.filter.mode === 'turbo'
        ? ['TURBO']
        : ['CAPTAINS_MODE', 'RANDOM_DRAFT', 'ALL_PICK_RANKED', ...(summary.filter.mode === 'all' ? ['TURBO'] : [])];
    const seen = new Set<number>();
    const matches =
      raw?.matches.filter((match) => {
        if (
          match.endDateTime < capture.timestamp - summary.days * 86400 ||
          match.endDateTime > capture.timestamp ||
          match.durationSeconds <= 0 ||
          !allowed.includes(match.gameMode) ||
          !['UNRANKED', 'PRACTICE', 'TOURNAMENT', 'RANKED', 'BATTLE_CUP'].includes(match.lobbyType) ||
          (summary.filter.rankedOnly && summary.filter.mode !== 'turbo' && match.lobbyType === 'UNRANKED') ||
          seen.has(match.id)
        )
          return false;
        seen.add(match.id);
        return match.players.filter((player) => String(player.steamAccountId) === summary.accountId).length === 1;
      }) ?? [];
    expect(summary.matches.map((match) => match.match_id).sort()).toEqual(matches.map((match) => match.id).sort());
    const wins = matches.filter(
      (match) =>
        typeof match.didRadiantWin === 'boolean' &&
        match.players.find((player) => String(player.steamAccountId) === summary.accountId)?.isRadiant ===
          match.didRadiantWin,
    ).length;
    expect(summary.matches.filter((match) => matchWon(match) === true)).toHaveLength(wins);
    expect(summary.heroes.reduce((sum, hero) => sum + hero.win, 0)).toBe(wins);
  }
});

audit('checks 25-cell matrices, candidate exclusions and complete score decomposition on real drafts', () => {
  const capture = read<Captures>('normalized.json');
  const heroes = read<Hero[]>('opendota-heroes.json');
  const matchups = new Map(capture.drafts.flatMap((data) => data.matchups).map((row) => [row.heroId, row]));
  const data: DraftData = {
    source: 'STRATZ',
    fetchedAt: new Date(capture.timestamp * 1000).toISOString(),
    positions: capture.drafts[0].positions,
    matchups: [...matchups.values()],
  };
  const rolesFor = (id: number) => {
    const rows = data.positions.filter((row) => row.heroId === id);
    const total = rows.reduce((sum, row) => sum + row.matchCount, 0);
    return new Set(
      rows
        .filter((row) => row.matchCount >= 200 && row.matchCount / total >= MAIN_POSITION_SHARE)
        .map((row) => row.position),
    );
  };
  const measuredPair = (source: number, candidate: number, kind: 'vs' | 'with') => {
    const pair = matchups.get(source)?.[kind].find((row) => row.heroId2 === candidate);
    if (!pair || pair.matchCount < 100 || pair.synergy === null || pair.synergy === 666) return undefined;
    return pair.synergy / (1 + (kind === 'vs' ? 1300 : 2500) / pair.matchCount);
  };
  const scenarios = read<{ match_id: number; radiant_team: number[]; dire_team: number[] }[]>('public-selection.json');
  const ranked = read<{
    data: Record<string, { id: number; players: { heroId: number; isRadiant: boolean; playerSlot: number }[] } | null>;
  }>('ranked-matches.json');
  for (const match of Object.values(ranked.data)) {
    if (!match) continue;
    const side = (radiant: boolean) =>
      match.players
        .filter((player) => player.isRadiant === radiant)
        .sort((a, b) => a.playerSlot - b.playerSlot)
        .map((player) => player.heroId);
    scenarios.push({ match_id: match.id, radiant_team: side(true), dire_team: side(false) });
  }
  const reports = scenarios.map((scenario) => {
    const allies = scenario.radiant_team,
      enemies = scenario.dire_team;
    const matrix = allies.map((a) =>
      enemies.map((b) => {
        const forward = matchups.get(a)?.vs.find((pair) => pair.heroId2 === b);
        const reverse = matchups.get(b)?.vs.find((pair) => pair.heroId2 === a);
        const known = (pair: typeof forward) =>
          !!pair && pair.matchCount >= MIN_PAIR_GAMES && typeof pair.synergy === 'number' && pair.synergy !== 666;
        const value = matchupAdvantage(data, a, b);
        if (
          known(forward) &&
          known(reverse) &&
          forward &&
          reverse &&
          forward.synergy !== null &&
          reverse.synergy !== null
        ) {
          const expected =
            (forward.synergy / (1 + 1300 / forward.matchCount) - reverse.synergy / (1 + 1300 / reverse.matchCount)) / 2;
          expect(value).toBeCloseTo(expected, 10);
          expect(matchupAdvantage(data, b, a)).toBeCloseTo(-expected, 10);
        } else expect(value).toBeUndefined();
        return { a, b, value, raw: forward?.synergy, games: forward?.matchCount };
      }),
    );
    expect(matrix.flat()).toHaveLength(25);
    const excluded = [...allies, ...enemies];
    const rows = scorePositions(heroes, data, allies, enemies, [14]);
    for (const row of Object.values(rows).flat()) {
      expect([...excluded, 14]).not.toContain(row.hero.id);
      expect(Number.isFinite(row.score)).toBe(true);
      expect(row.score).toBeCloseTo(row.counter + row.synergy, 12);
      const enemyPairs = enemies.map((id) => measuredPair(id, row.hero.id, 'vs'));
      expect(row.counter).toBeCloseTo(
        -enemyPairs.reduce<number>((sum, value) => sum + (value ?? 0), 0) / enemies.length,
        10,
      );
      let synergy = 0;
      let covered = enemyPairs.filter((value) => value !== undefined).length;
      for (const ally of allies) {
        const value = measuredPair(ally, row.hero.id, 'with');
        if (value === undefined) continue;
        covered++;
        const weighted = value / 2;
        synergy += (Math.sign(weighted) * Math.round((Math.abs(weighted) + Number.EPSILON) * 100)) / 100;
        const candidateRoles = rolesFor(row.hero.id),
          allyRoles = rolesFor(ally);
        if (candidateRoles.size === 1 && allyRoles.size === 1 && [...candidateRoles][0] === [...allyRoles][0])
          synergy -= 100;
      }
      expect(row.synergy).toBeCloseTo(synergy / allies.length, 10);
      expect(row.coverage).toBe(covered);
      expect(row.coverage).toBeLessThanOrEqual(row.expected);
      expect(row.base).toBeGreaterThanOrEqual(0);
      expect(row.base).toBeLessThanOrEqual(100);
    }
    for (const row of counterPicks(heroes, data, enemies, excluded, [14])) {
      expect(row.counters.length).toBeLessThanOrEqual(10);
      for (const counter of row.counters) {
        expect([...excluded, 14]).not.toContain(counter.hero.id);
        const pair = matchups.get(row.enemy.id)?.vs.find((pair) => pair.heroId2 === counter.hero.id);
        expect(counter.advantage).toBe(-(pairAdvantage(pair) ?? NaN));
      }
    }
    for (const rows of Object.values(metaPicks(heroes, data, excluded, [14]))) {
      expect(rows.length).toBeLessThanOrEqual(6);
      for (const row of rows) expect(row.winRate).toBeCloseTo((100 * row.wins) / row.games, 10);
    }
    return {
      matchId: scenario.match_id,
      matrix,
      suggestions: Object.fromEntries(Object.entries(rows).map(([position, rows]) => [position, rows.slice(0, 6)])),
    };
  });
  writeFileSync(join(directory ?? '', 'formula-report.json'), JSON.stringify(reports, null, 2));
});

audit('checks profile KDA and result filtering against captured history', () => {
  for (const page of read<Captures>('normalized.json').histories) {
    const complete = page.matches.filter((match) =>
      [match.kills, match.deaths, match.assists].every((value) => typeof value === 'number' && value >= 0),
    );
    const expected = complete.length
      ? (['kills', 'deaths', 'assists'] as const)
          .map((key) =>
            String(Number((complete.reduce((sum, match) => sum + (match[key] ?? 0), 0) / complete.length).toFixed(1))),
          )
          .join(' / ')
      : '—';
    expect(averageKda(page.matches)).toBe(expected);
    const wins = filterHistory(page.matches, { days: 0, hero: 0, result: 'win', includeTurbo: true });
    expect(wins.every((match) => matchWon(match) === true)).toBe(true);
    expect(new Set(page.matches.map((match) => match.match_id)).size).toBe(page.matches.length);
  }
});

audit('keeps real-data scores finite across 100 seeded partial drafts and hover replacements', () => {
  const capture = read<Captures>('normalized.json');
  const heroes = read<Hero[]>('opendota-heroes.json');
  const matchups = new Map(capture.drafts.flatMap((data) => data.matchups).map((row) => [row.heroId, row]));
  const data: DraftData = {
    source: 'STRATZ',
    fetchedAt: new Date(capture.timestamp * 1000).toISOString(),
    positions: capture.drafts[0].positions,
    matchups: [...matchups.values()],
  };
  let seed = 20261014;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  let changed = 0;
  for (let run = 0; run < 100; run++) {
    const pool = [...matchups.keys()];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const allies = pool.slice(0, 1 + (run % 5)),
      enemies = pool.slice(5, 6 + (run % 5)),
      bans = pool.slice(10, 12);
    const confirmed = [...allies.slice(1), ...enemies];
    const before = scorePositions(heroes, data, allies, enemies, bans, 50, confirmed);
    const after = scorePositions(heroes, data, [pool[12], ...allies.slice(1)], enemies, bans, 50, confirmed);
    for (const rows of Object.values(before)) {
      expect(new Set(rows.map((row) => row.hero.id)).size).toBe(rows.length);
      for (const row of rows) {
        expect(Number.isFinite(row.score)).toBe(true);
        expect([...confirmed, ...bans]).not.toContain(row.hero.id);
      }
      for (let i = 1; i < rows.length; i++) expect(rows[i].score).toBeLessThanOrEqual(rows[i - 1].score);
    }
    if (JSON.stringify(before) !== JSON.stringify(after)) changed++;
    expect(scorePositions(heroes, data, allies, enemies, bans, 50, confirmed)).toEqual(before);
  }
  expect(changed).toBe(100);
});
