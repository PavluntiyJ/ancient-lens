import { expect, it } from 'vitest';
import {
  draftSlotPlayer,
  visibleDraftSlots,
  visibleDraftBans,
  visibleDraftHovers,
  visibleDraftLanes,
  visibleDraftPicks,
} from '../src/shared/live-draft';
import { normalizeLive, type LiveState, type TeamSlot } from '../src/shared/domain';
const phase = 'DOTA_GAMERULES_STATE_HERO_SELECTION';
const live: LiveState = {
  status: 'connected',
  receivedAt: 1000,
  matchId: '123',
  gameState: phase,
  mode: 'player',
  players: [{ key: 'self', team: 'dire' }],
  draftStatus: 'ready',
  draft: {
    matchId: '123',
    gameState: phase,
    source: 'native',
    observedAt: 1000,
    picks: [
      { slot: 0, team: 'radiant', heroId: 1 },
      { slot: 5, team: 'dire', heroId: 2 },
    ],
  },
};
it('uses anonymous picks without adding identities or requiring a selected own hero', () => {
  const input = structuredClone(live);
  expect(visibleDraftPicks(input, true, 1001)).toEqual([
    { team: 'radiant', heroId: 1 },
    { team: 'dire', heroId: 2 },
  ]);
  expect(input).toEqual(live);
  expect(input.players?.flatMap((p) => (p.accountId ? [p.accountId] : []))).toEqual([]);
});
it('replaces removed and swapped picks instead of accumulating them', () => {
  const input = structuredClone(live);
  input.draft!.picks[1].heroId = 3;
  expect(visibleDraftPicks(input, true, 1001).map((p) => p.heroId)).toEqual([1, 3]);
  input.players![0].heroId = 2;
  input.draft!.picks = [];
  expect(visibleDraftPicks(input, true, 1001)).toEqual([]);
});
it('drops snapshots from another match, phase, disconnected game or expired observation', () => {
  expect(visibleDraftPicks(live, false, 1001)).toEqual([]);
  expect(visibleDraftPicks(live, true, 16000)).toEqual([]);
  expect(visibleDraftPicks({ ...live, matchId: '124' }, true, 1001)).toEqual([]);
  expect(visibleDraftPicks({ ...live, gameState: 'DOTA_GAMERULES_STATE_STRATEGY_TIME' }, true, 1001)).toEqual([]);
  expect(visibleDraftPicks({ ...live, gameState: 'DOTA_GAMERULES_STATE_POST_GAME' }, true, 1001)).toEqual([]);
  expect(visibleDraftPicks({ ...live, matchId: '0' }, true, 1001)).toEqual([]);
});
it('preserves GSI picks for spectator and degraded native data', () => {
  const input: LiveState = { ...live, players: [{ key: 'self', team: 'dire', heroId: 3 }] };
  expect(visibleDraftPicks({ ...input, mode: 'spectator' }, true, 1001)).toEqual([{ team: 'dire', heroId: 3 }]);
  expect(visibleDraftPicks({ ...input, draft: undefined, draftStatus: 'unavailable' }, true, 1001)).toEqual([
    { team: 'dire', heroId: 3 },
  ]);
});
it('rejects duplicate and malformed heroes', () => {
  const input = structuredClone(live);
  input.draft!.picks[1].heroId = 1;
  expect(visibleDraftPicks(input, true, 1001)).toEqual([]);
  input.draft!.picks[1].heroId = 1001;
  expect(visibleDraftPicks(input, true, 1001)).toEqual([]);
});

it('ignores unselected GSI heroes while keeping known spectator picks', () => {
  const input: LiveState = {
    ...live,
    mode: 'spectator',
    players: [
      { key: 'team2.player0', team: 'radiant', heroId: 1 },
      { key: 'team3.player5', team: 'dire', heroId: -1 },
      { key: 'team3.player6', team: 'dire', heroId: 0 },
    ],
  };
  expect(visibleDraftPicks(input, true, 1001)).toEqual([{ team: 'radiant', heroId: 1 }]);
});

it('exposes native bans only for the current fresh snapshot and rejects ambiguous lists', () => {
  const input = structuredClone(live);
  expect(visibleDraftBans(input, true, 1001)).toBeUndefined();
  input.draft!.bans = [];
  expect(visibleDraftBans(input, true, 1001)).toEqual([]);
  input.draft!.bans = [14, 74];
  expect(visibleDraftBans(input, true, 1001)).toEqual([14, 74]);
  expect(visibleDraftBans(input, false, 1001)).toBeUndefined();
  expect(visibleDraftBans(input, true, 16000)).toBeUndefined();
  expect(visibleDraftBans({ ...input, mode: 'spectator' }, true, 1001)).toBeUndefined();
  for (const bans of [[1], [14, 14], [0], [1001]])
    expect(visibleDraftBans({ ...input, draft: { ...input.draft!, bans } }, true, 1001)).toBeUndefined();
});

it('keeps anonymous hovers separate from confirmed picks and replaces changes', () => {
  const input = structuredClone(live);
  input.draft!.hovers = [
    { slot: 6, team: 'dire', heroId: 74 },
    { slot: 1, team: 'radiant', heroId: 17 },
  ];
  input.draft!.lanes = [
    { slot: 6, team: 'dire', flags: 4 },
    { slot: 1, team: 'radiant', flags: 24 },
  ];
  expect(visibleDraftHovers(input, true, 1001)).toEqual(input.draft!.hovers);
  expect(visibleDraftLanes(input, true, 1001)).toEqual(input.draft!.lanes);
  expect(visibleDraftPicks(input, true, 1001)).toHaveLength(2);
  expect(input.players).toEqual(live.players);
  input.draft!.hovers[0].heroId = 700;
  expect(visibleDraftHovers(input, true, 1001)[0].heroId).toBe(700);
  input.draft!.hovers = [];
  input.draft!.lanes = [];
  expect(visibleDraftHovers(input, true, 1001)).toEqual([]);
  expect(visibleDraftLanes(input, true, 1001)).toEqual([]);
});
it('ignores hovers of confirmed or banned heroes without discarding valid intentions', () => {
  const input = structuredClone(live);
  input.draft!.bans = [14];
  input.draft!.hovers = [
    { slot: 6, team: 'dire', heroId: 74 },
    { slot: 7, team: 'dire', heroId: 14 },
    { slot: 5, team: 'dire', heroId: 2 },
    { slot: 1, team: 'radiant', heroId: 1 },
  ];
  expect(visibleDraftHovers(input, true, 1001)).toEqual([{ slot: 6, team: 'dire', heroId: 74 }]);
  for (const heroId of [0, 1001, 1.5]) {
    input.draft!.hovers = [{ slot: 6, team: 'dire', heroId }];
    expect(visibleDraftHovers(input, true, 1001)).toEqual([]);
  }
  input.draft!.hovers = [
    { slot: 6, team: 'dire', heroId: 74 },
    { slot: 6, team: 'dire', heroId: 17 },
  ];
  expect(visibleDraftHovers(input, true, 1001)).toEqual([]);
});
it('never reuses intentions across matches, phases, expiry or disabled native reader', () => {
  const input = structuredClone(live);
  input.draft!.hovers = [{ slot: 6, team: 'dire', heroId: 74 }];
  input.draft!.lanes = [{ slot: 6, team: 'dire', flags: 4 }];
  for (const changed of <LiveState[]>[
    { ...input, matchId: '124' },
    { ...input, matchId: '0' },
    { ...input, mode: 'spectator' as const },
    { ...input, draftStatus: 'disabled' },
    { ...input, draftStatus: 'retrying' },
    { ...input, draft: undefined },
    { ...input, gameState: 'DOTA_GAMERULES_STATE_STRATEGY_TIME' },
    { ...input, gameState: 'DOTA_GAMERULES_STATE_POST_GAME' },
  ]) {
    expect(visibleDraftHovers(changed, true, 1001)).toEqual([]);
    expect(visibleDraftLanes(changed, true, 1001)).toEqual([]);
  }
  for (const now of [999, 16000]) {
    expect(visibleDraftHovers(input, true, now)).toEqual([]);
    expect(visibleDraftLanes(input, true, now)).toEqual([]);
  }
  expect(visibleDraftHovers(input, false, 1001)).toEqual([]);
  expect(visibleDraftLanes(input, false, 1001)).toEqual([]);
});
it('rejects invalid slot and lane masks while preserving multi-role flags', () => {
  const input = structuredClone(live);
  for (const flags of [0, 32, 255, -1, 2.5]) {
    input.draft!.lanes = [{ slot: 6, team: 'dire', flags }];
    expect(visibleDraftLanes(input, true, 1001)).toEqual([]);
  }
  for (const slot of [-1, 64, 1.5]) {
    input.draft!.lanes = [{ slot, team: 'dire', flags: 4 }];
    input.draft!.hovers = [{ slot, team: 'dire', heroId: 74 }];
    expect(visibleDraftLanes(input, true, 1001)).toEqual([]);
    expect(visibleDraftHovers(input, true, 1001)).toEqual([]);
  }
  input.draft!.lanes = [{ slot: 6, team: 'dire', flags: 31 }];
  expect(visibleDraftLanes(input, true, 1001)[0].flags).toBe(31);
});

it('maps unknown reader statuses from the backend to unavailable', () => {
  const raw = { ...live, rosterStatus: 'brand-new', draftStatus: 'ready' } as unknown as LiveState;
  expect(normalizeLive(raw)).toMatchObject({ rosterStatus: 'unavailable', draftStatus: 'ready' });
  expect(normalizeLive({ ...live, draftStatus: undefined }).draftStatus).toBeUndefined();
  expect(raw.rosterStatus).toBe('brand-new');
});

it('orders ten anonymous draft rows by team slot and shows self only when known', () => {
  const input: LiveState = { ...structuredClone(live), selfTeamSlot: 3 };
  input.draft!.slots = [
    { slot: 0, team: 'radiant', teamSlot: 4 },
    { slot: 5, team: 'dire', teamSlot: 2 },
    { slot: 6, team: 'dire', teamSlot: 3 },
    { slot: 1, team: 'radiant', teamSlot: 0 },
  ];
  input.draft!.hovers = [{ slot: 6, team: 'dire', heroId: 74 }];
  input.draft!.lanes = [{ slot: 6, team: 'dire', flags: 24 }];
  const rows = visibleDraftSlots(input, true, 1001);
  expect(rows.radiant.map((row) => row.teamSlot)).toEqual([0, 1, 2, 3, 4]);
  expect(rows.dire).toHaveLength(5);
  expect(rows.radiant[4]).toMatchObject({ slot: 0, pick: 1 });
  expect(rows.dire[2]).toMatchObject({ slot: 5, pick: 2, isSelf: false });
  expect(rows.dire[3]).toMatchObject({ slot: 6, hover: 74, lanes: [4, 5], isSelf: true });
  expect(visibleDraftSlots({ ...input, selfTeamSlot: undefined }, true, 1001).dire.some((row) => row.isSelf)).toBe(
    false,
  );
  expect(input.players).toEqual(live.players);
});
it('keeps banned hovers in the row but excludes them from calculation input', () => {
  const input = structuredClone(live);
  input.draft!.slots = [{ slot: 6, team: 'dire', teamSlot: 3 }];
  input.draft!.hovers = [{ slot: 6, team: 'dire', heroId: 14 }];
  input.draft!.bans = [14];
  expect(visibleDraftSlots(input, true, 1001).dire[3]).toMatchObject({ hover: 14, hoverBanned: true });
  expect(visibleDraftHovers(input, true, 1001)).toEqual([]);
  input.draft!.picks.push({ slot: 6, team: 'dire', heroId: 74 });
  expect(visibleDraftSlots(input, true, 1001).dire[3]).toMatchObject({
    pick: 74,
    hover: undefined,
    hoverBanned: false,
  });
});
it('preserves legacy global-slot order when team slots are absent, with no invented self', () => {
  const input = structuredClone(live);
  input.draft!.slots = [
    { slot: 6, team: 'dire', teamSlot: -1 },
    { slot: 5, team: 'dire', teamSlot: -1 },
  ];
  input.draft!.hovers = [{ slot: 6, team: 'dire', heroId: 74 }];
  const rows = visibleDraftSlots(input, true, 1001);
  expect(rows.dire.slice(0, 2).map((row) => row.slot)).toEqual([5, 6]);
  expect(rows.dire.some((row) => row.isSelf)).toBe(false);
  expect(draftSlotPlayer(input, 'dire', rows.dire[0], rows)).toBeUndefined();
});
it('maps roster identity onto the same draft row at Strategy Time, including self', () => {
  const input = structuredClone(live);
  input.draft!.slots = Array.from({ length: 5 }, (_, i) => ({
    slot: i + 5,
    team: 'dire',
    teamSlot: ((i + 2) % 5) as TeamSlot,
  }));
  input.players = Array.from({ length: 5 }, (_, i) => ({
    key: i === 1 ? 'self' : `native.${i + 5}`,
    team: 'dire',
    accountId: String(i + 1),
  }));
  const rows = visibleDraftSlots(input, true, 1001);
  expect(rows.dire[3].isSelf).toBe(true);
  expect(draftSlotPlayer(input, 'dire', rows.dire[3], rows)?.key).toBe('self');
  expect(draftSlotPlayer(input, 'dire', rows.dire[2], rows)?.key).toBe('native.5');
});
it('uses spectator team slots and clears anonymous data on expiry or disabled reading', () => {
  const spectator: LiveState = {
    ...live,
    mode: 'spectator',
    players: [{ key: 'team2.player0', team: 'radiant', teamSlot: 4, heroId: 1 }],
  };
  expect(visibleDraftSlots(spectator, true, 1001).radiant[4].pick).toBe(1);
  const input = structuredClone(live);
  input.draft!.slots = [{ slot: 5, team: 'dire', teamSlot: 3 }];
  for (const [state, connected, now] of [
    [input, false, 1001],
    [input, true, 16000],
    [{ ...input, matchId: '124' }, true, 1001],
    [{ ...input, draftStatus: 'disabled' }, true, 1001],
  ] as const) {
    const rows = visibleDraftSlots(state, connected, now);
    expect(
      [...rows.radiant, ...rows.dire].every(
        (row) => row.pick === undefined && row.hover === undefined && row.slot === undefined && row.lanes.length === 0,
      ),
    ).toBe(true);
  }
  expect(normalizeLive({ ...input, selfTeamSlot: 5 } as unknown as LiveState).selfTeamSlot).toBeUndefined();
});
it('shows a frozen snapshot as of its own moment, while live data still expires', () => {
  // A held or post-game view renders the last running snapshot with its observation time.
  const minuteLater = 61_000;
  expect(visibleDraftPicks(live, true, minuteLater)).toEqual([]);
  expect(visibleDraftPicks(live, true, live.draft!.observedAt)).toHaveLength(2);
  expect(visibleDraftSlots(live, true, live.draft!.observedAt).radiant.some((slot) => slot.pick === 1)).toBe(true);
});
it('shows role-queue roles while players load, before hero selection', () => {
  const loading = 'DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD';
  const lanes = [
    { slot: 0, team: 'radiant' as const, flags: 16 },
    { slot: 5, team: 'dire' as const, flags: 4 },
  ];
  const input: LiveState = {
    ...structuredClone(live),
    gameState: loading,
    draft: { ...structuredClone(live.draft!), gameState: loading, picks: [], lanes },
  };
  expect(visibleDraftLanes(input, true, 1001)).toEqual(lanes);
  expect(visibleDraftSlots(input, true, 1001).dire[0]?.lanes).toEqual([2]);
});
