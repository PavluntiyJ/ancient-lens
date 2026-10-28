import { expect, it } from 'vitest';
import type { LiveState } from '../src/shared/domain';
import { laneForPosition, draftLanes } from '../src/shared/draft';
import { HOLD_MS, holdMatch } from '../src/shared/match-session';

const live = (patch: Partial<LiveState>): LiveState => ({ status: 'connected', receivedAt: 0, ...patch });
const running = live({ mode: 'player', matchId: '9044597303', gameState: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS' });

it('keeps the running match through a reconnect and releases it at the real end', () => {
  const first = holdMatch(undefined, running, true, 1000);
  expect(first).toMatchObject({ view: running, suspended: false, lingering: false });
  // Disconnected to the menu: GSI goes on without a match.
  const menu = live({ mode: 'player' });
  const away = holdMatch(first.held, menu, true, 60_000);
  expect(away).toMatchObject({ view: running, suspended: true, lingering: false });
  // Dota itself restarting: no fresh GSI at all.
  expect(holdMatch(first.held, menu, false, 90_000).view).toBe(running);
  // Back in the same match: the live packet is used again.
  const back = live({ ...running, clock: 900 });
  const returned = holdMatch(away.held, back, true, 120_000);
  expect(returned).toMatchObject({ view: back, suspended: false, frozen: false });
  // Post-game no longer carries the draft: the last running snapshot is shown, frozen,
  // while the header follows the real phase.
  const post = live({ ...running, gameState: 'DOTA_GAMERULES_STATE_POST_GAME' });
  const ended = holdMatch(returned.held, post, true, 130_000);
  expect(ended).toMatchObject({ view: back, frozen: true, phase: 'DOTA_GAMERULES_STATE_POST_GAME' });
  expect(ended).toMatchObject({ suspended: false, lingering: false });
  // Leaving after the end keeps that snapshot as the last match, not as a reconnect.
  expect(holdMatch(ended.held, menu, true, 140_000)).toMatchObject({
    view: back,
    frozen: true,
    suspended: false,
    lingering: true,
  });
  // A post-game packet of a match never seen running has nothing to freeze.
  const other = live({ ...post, matchId: '9044600001' });
  expect(holdMatch(ended.held, other, true, 150_000)).toMatchObject({ view: other, frozen: false });
});

it('freezes the draft of a held reconnect instead of letting it expire', () => {
  const first = holdMatch(undefined, running, true, 1000);
  const away = holdMatch(first.held, live({ mode: 'player' }), true, 60_000);
  expect(away).toMatchObject({ view: running, suspended: true, frozen: true });
  expect(first.frozen).toBe(false);
});

it('keeps the last spectated match until another match appears', () => {
  const spectating = live({ ...running, mode: 'spectator' });
  const watched = holdMatch(undefined, spectating, true, 0);
  expect(watched).toMatchObject({ view: spectating, lingering: false });
  // Back to the menu, or Dota closed: the roster lingers, without an expiry.
  const menu = live({ mode: 'player' });
  expect(holdMatch(watched.held, menu, true, 10)).toMatchObject({
    view: spectating,
    suspended: false,
    lingering: true,
  });
  expect(holdMatch(watched.held, menu, false, HOLD_MS * 10)).toMatchObject({ view: spectating, lingering: true });
  // A new match or a new spectated game replaces it.
  const next = live({ mode: 'spectator', matchId: '9044600000', gameState: 'DOTA_GAMERULES_STATE_PRE_GAME' });
  expect(holdMatch(watched.held, next, true, 20)).toMatchObject({ view: next, lingering: false });
});

it('replaces the held match with fresh data and turns an expired reconnect into the last match', () => {
  const { held } = holdMatch(undefined, running, true, 0);
  const next = live({ mode: 'player', matchId: '9044600000', gameState: 'DOTA_GAMERULES_STATE_HERO_SELECTION' });
  expect(holdMatch(held, next, true, 10).view).toBe(next);
  // Spectating the same match ID shows the fresh spectator data, not the old snapshot.
  expect(holdMatch(held, live({ ...running, mode: 'spectator' }), true, 10)).toMatchObject({ suspended: false });
  expect(holdMatch(held, live({ mode: 'player' }), true, HOLD_MS + 1)).toMatchObject({
    view: running,
    suspended: false,
    lingering: true,
  });
  expect(holdMatch(undefined, live({ mode: 'player' }), true, 0)).toMatchObject({ suspended: false, lingering: false });
});

it('maps an assigned position to its lane', () => {
  const lane = (position: 1 | 2 | 3 | 4 | 5) => draftLanes[laneForPosition(position)]!.id;
  expect([lane(1), lane(2), lane(3), lane(4), lane(5)]).toEqual(['safe', 'mid', 'off', 'off', 'safe']);
});
