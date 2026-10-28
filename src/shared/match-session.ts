import type { LiveState } from './domain';

/** Phases of a running match from the player's side, before the post-game screen. */
const RUNNING = new Set([
  'DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD',
  'DOTA_GAMERULES_STATE_HERO_SELECTION',
  'DOTA_GAMERULES_STATE_STRATEGY_TIME',
  'DOTA_GAMERULES_STATE_TEAM_SHOWCASE',
  'DOTA_GAMERULES_STATE_WAIT_FOR_MAP_TO_LOAD',
  'DOTA_GAMERULES_STATE_PRE_GAME',
  'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
]);
/** Longer than Dota's reconnect window, so a slow return still finds the match. */
export const HOLD_MS = 15 * 60_000;

/** live: the latest packet; running: the last packet of the same match in a draft/game phase. */
export type HeldMatch = { live: LiveState; at: number; running?: LiveState };
/**
 * view: the state to render. suspended: a running player match waiting for a reconnect;
 * lingering: the last match (played or spectated) kept after leaving it; frozen: view is the
 * last running snapshot, so its draft is shown as of that moment rather than checked for
 * freshness; phase: the real current phase when it differs from the frozen view.
 */
export type MatchView = {
  held?: HeldMatch;
  view: LiveState;
  suspended: boolean;
  lingering: boolean;
  frozen: boolean;
  phase?: string;
};

/**
 * Keeps the last match on screen once Dota stops reporting it.
 * A missing match state is not "match ended": a live ranked check showed the same
 * match coming back after each reconnect.
 * Post-game packets no longer carry the draft, so the last running snapshot of the same
 * match is shown frozen under the real phase. Without fresh data, a running player match
 * within HOLD_MS is a reconnect; anything else lingers as the last match until fresh data
 * about any match (the same one, another one, or a new spectated game) arrives.
 */
export function holdMatch(held: HeldMatch | undefined, live: LiveState, connected: boolean, now: number): MatchView {
  const id = live.matchId && live.matchId !== '0' ? live.matchId : undefined;
  if (connected && id) {
    if (RUNNING.has(live.gameState ?? ''))
      return { held: { live, at: now, running: live }, view: live, suspended: false, lingering: false, frozen: false };
    const running = held?.running?.matchId === id ? held.running : undefined;
    return running
      ? {
          held: { live, at: now, running },
          view: running,
          suspended: false,
          lingering: false,
          frozen: true,
          phase: live.gameState,
        }
      : { held: { live, at: now }, view: live, suspended: false, lingering: false, frozen: false };
  }
  // No match on screen (main menu, Dota closed or no GSI at all).
  if (!held) return { view: live, suspended: false, lingering: false, frozen: false };
  const reconnect = held.live.mode === 'player' && RUNNING.has(held.live.gameState ?? '') && now - held.at <= HOLD_MS;
  const view = held.running ?? held.live;
  return { held, view, suspended: reconnect, lingering: !reconnect, frozen: view === held.running };
}
