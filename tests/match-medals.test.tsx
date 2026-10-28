import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as brackets from '../src/shared/rank-bracket';
import { MatchScreen } from '../src/ui/MatchScreen';

vi.mock('../src/ui/App', () => ({ api: {}, errorMessage: String }));
vi.mock('../src/ui/preferences', () => ({
  useStatsFilter: () => ({ mode: 'normal', rankedOnly: false }),
  useDisplaySettings: () => ({ scale: 100, rank: true, totals: true, frequent: true }),
  useSynergyWeight: () => 50,
  useMinWinRate: () => ({ enabled: false, value: 50 }),
  useEncounterSound: () => false,
  useRankBracket: () => 'auto',
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('chooses the match bracket and journal medal from memory before profiles load', () => {
  vi.stubGlobal('localStorage', { getItem: () => null });
  const choose = vi.spyOn(brackets, 'chooseBracket');
  const median = vi.spyOn(brackets, 'matchMedalTier');
  renderToStaticMarkup(
    <MatchScreen
      ownAccountId="1"
      active={true}
      platform="linux"
      providerRevision={0}
      live={{
        status: 'connected',
        receivedAt: Date.now(),
        matchId: '123',
        mode: 'player',
        gameState: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
        players: [
          { key: 'self', accountId: '1', team: 'radiant', heroId: 74, rankTier: 75 },
          { key: 'linux.1', accountId: '2', team: 'radiant', rankTier: 54 },
          { key: 'linux.5', team: 'dire', rankTier: 80 },
          { key: 'linux.6', accountId: '3', team: 'dire' },
        ],
      }}
      connected={true}
      notes={[]}
      setup={() => {}}
    />,
  );
  expect(choose.mock.results[0].value).toEqual({ bracket: 'DIVINE_IMMORTAL', source: 'match' });
  expect(median).toHaveBeenCalledWith([75, 54, 80, undefined]);
  expect(median.mock.results.at(-1)?.value).toBe(75);
});
