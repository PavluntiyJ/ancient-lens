import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HeaderNav } from '../src/ui/HeaderNav';
import { ConnectionsOverview } from '../src/ui/settings/ConnectionsOverview';
import { settingsGroups } from '../src/ui/settings/sections';
import { MatchScreen } from '../src/ui/MatchScreen';
import type { LiveState } from '../src/shared/domain';

vi.mock('../src/ui/App', () => ({ api: {}, errorMessage: String }));
vi.mock('../src/ui/preferences', () => ({
  useStatsFilter: () => ({ mode: 'normal', rankedOnly: false }),
  useDisplaySettings: () => ({ scale: 100, rank: true, totals: true, frequent: true }),
  useSynergyWeight: () => 50,
  useMinWinRate: () => ({ enabled: false, value: 50 }),
  useEncounterSound: () => false,
  useRankBracket: () => 'auto',
}));
afterEach(() => vi.unstubAllGlobals());

describe('Header', () => {
  it('shows match, profile, notes and settings, and no tools menu', () => {
    const html = renderToStaticMarkup(<HeaderNav page="home" open={() => {}} />);
    const labels = [...html.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((match) => match[1]);
    expect(labels).toEqual(['Match and draft', 'My profile', 'Notes', 'Settings']);
    expect(html).not.toContain('Tools');
    expect(html).not.toContain('Manual draft');
  });

  it('keeps the screen a tool belongs to lit while the tool is open', () => {
    const roster = renderToStaticMarkup(<HeaderNav page="roster" open={() => {}} />);
    expect(roster).toMatch(/class="active" aria-label="Match and draft"/);
    expect(roster).not.toContain('aria-current');
    const live = renderToStaticMarkup(<HeaderNav page="live" open={() => {}} />);
    expect(live).toMatch(/class="active" aria-label="Settings"/);
    const notes = renderToStaticMarkup(<HeaderNav page="notes" open={() => {}} />);
    expect(notes).toMatch(/class="active" aria-label="Notes" title="Notes" aria-current="page"/);
  });
});

describe('Settings', () => {
  it('groups every section, connections first', () => {
    expect(settingsGroups.map((group) => group.name)).toEqual([
      'Connections',
      'Match & statistics',
      'Interface',
      'Data',
    ]);
    expect(settingsGroups.flatMap((group) => group.sections.map(([id]) => id)).sort()).toEqual([
      'settings-appearance',
      'settings-data',
      'settings-game',
      'settings-provider',
      'settings-reader',
      'settings-shortcuts',
      'settings-sound',
      'settings-statistics',
      'settings-window',
    ]);
  });

  it('lists each connection with its state and a button to its section', () => {
    const html = renderToStaticMarkup(
      <ConnectionsOverview
        open={() => {}}
        rows={[
          {
            section: 'settings-game',
            name: 'Dota 2 (GSI)',
            icon: null,
            status: { tone: 'setup', label: 'Needs setup', detail: 'No events.', action: 'Set up' },
          },
          {
            section: 'settings-provider',
            name: 'STRATZ',
            icon: null,
            status: { tone: 'on', label: 'Connected', detail: '', action: 'Open' },
          },
        ]}
      />,
    );
    expect(html).toContain('<li class="connection-row setup">');
    expect(html).toContain('aria-label="Set up: Dota 2 (GSI)">Set up</button>');
    expect(html).toContain('class="primary"');
    expect(html).toContain('aria-label="Open: STRATZ">Open</button>');
    expect(html).toContain('connection-state on');
    // An empty detail leaves no empty line.
    expect(html.match(/<small>/g)).toHaveLength(1);
  });
});

describe('Match screen entry points', () => {
  const render = (live: LiveState, connected: boolean) => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    return renderToStaticMarkup(
      <MatchScreen
        ownAccountId="1"
        active={true}
        platform="linux"
        providerRevision={0}
        live={live}
        connected={connected}
        notes={[]}
        setup={() => {}}
        openTool={() => {}}
      />,
    );
  };

  it('offers the manual draft and roster while no game data arrives', () => {
    const html = render({ status: 'waiting', receivedAt: null }, false);
    expect(html).toContain('Without game data:');
    expect(html).toContain('>Manual draft</button>');
    expect(html).toContain('>Add players manually</button>');
  });

  it('offers adding players to an incomplete roster', () => {
    const html = render(
      {
        status: 'connected',
        receivedAt: Date.now(),
        matchId: '123',
        mode: 'spectator',
        gameState: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
        players: [{ key: 'player0', accountId: '2', team: 'radiant' }],
      },
      true,
    );
    expect(html).toContain('The game provided 1 of 10 players');
    expect(html).toContain('Add players manually</button>');
    expect(html).not.toContain('Without game data:');
  });
});
