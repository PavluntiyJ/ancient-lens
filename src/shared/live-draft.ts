import { draftLanePositions, type Position } from './roles';
import type { LivePlayer, LiveState, TeamSlot } from './domain';

const phases = new Set([
  'DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD',
  'DOTA_GAMERULES_STATE_HERO_SELECTION',
  'DOTA_GAMERULES_STATE_STRATEGY_TIME',
  'DOTA_GAMERULES_STATE_TEAM_SHOWCASE',
  'DOTA_GAMERULES_STATE_PRE_GAME',
  'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
]);
export type VisiblePick = { team: 'radiant' | 'dire'; heroId: number };

function nativeDraft(live: LiveState, now: number) {
  const draft = live.draft;
  return live.mode === 'player' &&
    live.draftStatus === 'ready' &&
    draft?.source === 'native' &&
    draft.matchId === live.matchId &&
    draft.gameState === live.gameState &&
    Number.isFinite(draft.observedAt) &&
    now >= draft.observedAt &&
    now - draft.observedAt < 15000
    ? draft
    : undefined;
}
const validHero = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0 && (id as number) <= 1000;

// A separate, replace-only snapshot: draft updates never populate player identity
// rows or determine which accounts are fetched. Spectators keep GSI picks.
export function visibleDraftPicks(live: LiveState, connected: boolean, now = Date.now()): VisiblePick[] {
  if (!connected || !live.matchId || live.matchId === '0' || !phases.has(live.gameState ?? '')) return [];
  const draft = nativeDraft(live, now);
  const rows: VisiblePick[] = draft
    ? draft.picks
    : (live.players ?? []).flatMap((player) =>
        validHero(player.heroId) ? [{ team: player.team, heroId: player.heroId }] : [],
      );
  // Unknown/invalid heroes must not become requests; reject ambiguous snapshots.
  if (
    rows.length > 10 ||
    rows.some((row) => !['radiant', 'dire'].includes(row.team) || !validHero(row.heroId)) ||
    new Set(rows.map((row) => row.heroId)).size !== rows.length ||
    ['radiant', 'dire'].some((team) => rows.filter((row) => row.team === team).length > 5)
  )
    return [];
  return rows.map(({ team, heroId }) => ({ team, heroId }));
}

// Bans exist only in the native snapshot (GSI never sends a participant's draft).
// undefined: no ban source; []: the source reports no bans yet.
export function visibleDraftBans(live: LiveState, connected: boolean, now = Date.now()): number[] | undefined {
  if (!connected || !live.matchId || live.matchId === '0' || !phases.has(live.gameState ?? '')) return undefined;
  const draft = nativeDraft(live, now);
  if (!draft || !Array.isArray(draft.bans)) return undefined;
  const picked = new Set(draft.picks.map((pick) => pick.heroId));
  const bans = draft.bans;
  if (
    bans.length > 24 ||
    !bans.every(validHero) ||
    new Set(bans).size !== bans.length ||
    bans.some((id) => picked.has(id))
  )
    return undefined;
  return [...bans];
}

export type VisibleHover = { team: 'radiant' | 'dire'; heroId: number; slot: number };
export type VisibleLane = { team: 'radiant' | 'dire'; flags: number; slot: number };
const validSlot = (slot: number) => Number.isInteger(slot) && slot >= 0 && slot < 64;
function intentions(live: LiveState, connected: boolean, now: number) {
  return connected && live.matchId && live.matchId !== '0' && phases.has(live.gameState ?? '')
    ? nativeDraft(live, now)
    : undefined;
}
function draftHovers(live: LiveState, connected: boolean, now: number): VisibleHover[] {
  const draft = intentions(live, connected, now);
  if (!draft || !Array.isArray(draft.hovers)) return [];
  const rows = draft.hovers;
  if (
    rows.length > 10 ||
    new Set(rows.map((row) => row.slot)).size !== rows.length ||
    ['radiant', 'dire'].some((team) => rows.filter((row) => row.team === team).length > 5)
  )
    return [];
  const excluded = new Set(draft.picks.map((pick) => pick.heroId));
  return rows
    .filter(
      (row) =>
        validSlot(row.slot) &&
        ['radiant', 'dire'].includes(row.team) &&
        validHero(row.heroId) &&
        !excluded.has(row.heroId) &&
        !draft.picks.some((pick) => pick.slot === row.slot && pick.team !== row.team),
    )
    .map(({ team, heroId, slot }) => ({ team, heroId, slot }));
}
export function visibleDraftHovers(live: LiveState, connected: boolean, now = Date.now()): VisibleHover[] {
  const bans = new Set(visibleDraftBans(live, connected, now) ?? []);
  return draftHovers(live, connected, now).filter((row) => !bans.has(row.heroId));
}
export function visibleDraftLanes(live: LiveState, connected: boolean, now = Date.now()): VisibleLane[] {
  const draft = intentions(live, connected, now);
  if (!draft || !Array.isArray(draft.lanes)) return [];
  const rows = draft.lanes;
  if (
    rows.length > 10 ||
    new Set(rows.map((row) => row.slot)).size !== rows.length ||
    ['radiant', 'dire'].some((team) => rows.filter((row) => row.team === team).length > 5)
  )
    return [];
  return rows
    .filter(
      (row) =>
        validSlot(row.slot) &&
        ['radiant', 'dire'].includes(row.team) &&
        Number.isInteger(row.flags) &&
        row.flags > 0 &&
        row.flags <= 31,
    )
    .map(({ team, flags, slot }) => ({ team, flags, slot }));
}

export const draftTeams = ['radiant', 'dire'] as const;
const teamSlots = [0, 1, 2, 3, 4] as const;
type Team = (typeof draftTeams)[number];
export type VisibleDraftSlot = {
  slot?: number;
  teamSlot: TeamSlot;
  pick?: number;
  hover?: number;
  hoverBanned: boolean;
  lanes: Position[];
  isSelf: boolean;
};
export type DraftSlots = Record<Team, VisibleDraftSlot[]>;
const validTeamSlot = (slot: number | undefined): slot is TeamSlot =>
  slot !== undefined && Number.isInteger(slot) && slot >= 0 && slot < 5;
const nativeSlot = (player: LivePlayer) => (/^native\.\d+$/.test(player.key) ? Number(player.key.slice(7)) : undefined);

// Native identities carry the same global index as the draft. The self row is
// the only exception; a complete roster identifies it by the one remaining slot.
export function draftSlotPlayer(
  live: LiveState,
  team: Team,
  row: VisibleDraftSlot,
  slots: DraftSlots,
): LivePlayer | undefined {
  const players = (live.players ?? []).filter((player) => player.team === team);
  if (row.slot !== undefined) {
    const identity = players.find((player) => nativeSlot(player) === row.slot);
    if (identity) return identity;
    const self = players.find((player) => player.key === 'self');
    if (self && row.isSelf) return self;
    const native = players.flatMap((player) => {
      const slot = nativeSlot(player);
      return slot === undefined ? [] : [slot];
    });
    const remaining = slots[team].filter((slot) => slot.slot !== undefined && !native.includes(slot.slot));
    if (
      self &&
      players.length === 5 &&
      native.length === 4 &&
      remaining.length === 1 &&
      remaining[0]?.slot === row.slot
    )
      return self;
    return undefined;
  }
  const explicit = players.find(
    (player) => player.teamSlot === row.teamSlot || (player.key === 'self' && live.selfTeamSlot === row.teamSlot),
  );
  if (explicit) return explicit;
  // Legacy GSI has no team slots. Preserve its existing roster order only when
  // no native slot mapping is present; never attach self to a guessed native row.
  if (slots[team].some((slot) => slot.slot !== undefined)) return undefined;
  const unmapped = players.filter(
    (player) => !validTeamSlot(player.teamSlot) && !(player.key === 'self' && validTeamSlot(live.selfTeamSlot)),
  );
  const free = teamSlots.filter(
    (slot) =>
      !players.some((player) => player.teamSlot === slot || (player.key === 'self' && live.selfTeamSlot === slot)),
  );
  return unmapped[free.indexOf(row.teamSlot)];
}

export function visibleDraftSlots(live: LiveState, connected: boolean, now = Date.now()): DraftSlots {
  const empty = (): VisibleDraftSlot[] =>
    teamSlots.map((teamSlot) => ({ teamSlot, hoverBanned: false, lanes: [], isSelf: false }));
  const slots: DraftSlots = { radiant: empty(), dire: empty() };
  if (!connected || !live.matchId || live.matchId === '0' || !phases.has(live.gameState ?? '')) return slots;
  const draft = intentions(live, connected, now);
  const picks = visibleDraftPicks(live, connected, now);
  const hovers = draftHovers(live, connected, now);
  const lanes = visibleDraftLanes(live, connected, now);
  const bans = new Set(visibleDraftBans(live, connected, now) ?? []);
  const self = live.mode === 'player' ? live.players?.find((player) => player.key === 'self') : undefined;
  for (const team of draftTeams) {
    if (draft) {
      const source = draft.slots ?? [...draft.picks, ...hovers, ...lanes].map((row) => ({ ...row, teamSlot: -1 }));
      const rows = [
        ...new Map(
          source.filter((row) => row.team === team && validSlot(row.slot)).map((row) => [row.slot, row]),
        ).values(),
      ]
        .sort((a, b) => a.slot - b.slot)
        .slice(0, 5);
      const assigned = new Set<number>();
      for (const row of rows) {
        if (!validTeamSlot(row.teamSlot) || rows.filter((other) => other.teamSlot === row.teamSlot).length !== 1)
          continue;
        const target = slots[team][row.teamSlot];
        if (target) {
          target.slot = row.slot;
          assigned.add(row.slot);
        }
      }
      // Old/missing schema fields: stable global-index order in the free rows.
      // Exact top-panel order cannot be established without m_iTeamSlot.
      for (const row of rows.filter((row) => !assigned.has(row.slot))) {
        const target = slots[team].find((slot) => slot.slot === undefined);
        if (target) target.slot = row.slot;
      }
      for (const row of slots[team]) {
        const pick = draft.picks.find(
          (pick) =>
            pick.team === team &&
            pick.slot === row.slot &&
            picks.some((valid) => valid.team === team && valid.heroId === pick.heroId),
        );
        const hover = hovers.find((hover) => hover.team === team && hover.slot === row.slot);
        row.pick = pick?.heroId;
        row.hover = pick ? undefined : hover?.heroId;
        row.hoverBanned = row.hover !== undefined && bans.has(row.hover);
        row.lanes = draftLanePositions(lanes.find((lane) => lane.team === team && lane.slot === row.slot)?.flags ?? 0);
      }
    }
    for (const row of slots[team]) {
      row.isSelf = self?.team === team && validTeamSlot(live.selfTeamSlot) && row.teamSlot === live.selfTeamSlot;
      const player = draftSlotPlayer(live, team, row, slots);
      if (player?.key === 'self' && row.slot !== undefined) row.isSelf = true;
      if (
        !draft &&
        player &&
        validHero(player.heroId) &&
        picks.some((pick) => pick.team === team && pick.heroId === player.heroId)
      )
        row.pick = player.heroId;
    }
  }
  return slots;
}
