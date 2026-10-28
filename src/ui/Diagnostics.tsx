import { useState } from 'react';
import { Activity, ArrowRight } from 'lucide-react';
import { formatDuration, type AppInfo, type LiveState } from '../shared/domain';
import { Empty, Notice, number, PageHeading, Stat } from './App';

/** What Dota 2 sends through Game State Integration right now, to check the connection. */
export function Diagnostics({
  live,
  connected,
  info,
  setup,
}: {
  live: LiveState;
  connected: boolean;
  info?: AppInfo;
  setup(): void;
}) {
  return (
    <>
      <PageHeading
        eyebrow="IN GAME"
        title="Current match"
        description="Statistics sent locally by Dota 2 through Game State Integration."
      />
      <div className="live-layout">
        <section className="panel">
          <LivePanel live={live} connected={connected} />
        </section>
        <section className="panel">
          <h2>Keep the match in view</h2>
          <p className="muted">
            Press Alt + Num 5 to bring this window over the game and again to hide it. Closing the window keeps Ancient
            Lens in the tray.
          </p>
          {info?.wayland && (
            <Notice>
              On Wayland, window position and always-on-top behavior are controlled by your window manager.
            </Notice>
          )}
          <button className="text-button" onClick={setup}>
            Set up connection <ArrowRight size={16} />
          </button>
        </section>
      </div>
    </>
  );
}

function LivePanel({ live, connected, compact = false }: { live: LiveState; connected: boolean; compact?: boolean }) {
  const [selectedKey, setSelectedKey] = useState('');
  const watched = live.players?.find((player) => player.key === selectedKey) ?? live.players?.[0];
  const stats = watched ?? live;
  if (live.status === 'error') return <Notice error>{live.error}</Notice>;
  if (!connected)
    return (
      <Empty
        icon={<Activity size={30} />}
        title={live.receivedAt ? 'Connection to the game interrupted' : 'No events from Dota 2'}
      >
        Install the GSI configuration from Settings, add -gamestateintegration to the Steam launch options, and restart
        Dota 2. Then play or spectate a match.
      </Empty>
    );
  return (
    <div className={compact ? 'live-panel compact' : 'live-panel'}>
      <div className="section-title">
        <span className="live-badge">LIVE</span>
        <strong className="mono">{live.clock === undefined ? '—' : formatDuration(live.clock)}</strong>
      </div>
      {watched && (
        <label className="field-label">
          Spectating · player
          <select aria-label="Player to spectate" value={watched.key} onChange={(e) => setSelectedKey(e.target.value)}>
            {live.players?.map((player) => (
              <option key={player.key} value={player.key}>
                {player.team === 'radiant' ? 'Radiant' : 'Dire'} · {player.name || player.hero || player.key}
              </option>
            ))}
          </select>
        </label>
      )}
      <h2 className="live-hero">
        {stats.hero || 'Hero selection'}
        {stats.level !== undefined && <span className="badge">LVL {stats.level}</span>}
      </h2>
      <p className="muted">
        {live.matchId && live.matchId !== '0' ? `Match #${live.matchId}` : 'Match without a public ID'}
      </p>
      <div className="live-numbers">
        <Stat label="K / D / A" value={`${number(stats.kills)} / ${number(stats.deaths)} / ${number(stats.assists)}`} />
        <Stat label="LH / DN" value={`${number(stats.lastHits)} / ${number(stats.denies)}`} />
        <Stat label="Gold" value={number(stats.gold)} />
      </div>
      {stats.maxHealth !== undefined && (
        <div className="vital">
          <label>
            Health{' '}
            <span>
              {number(stats.health)} / {number(stats.maxHealth)}
            </span>
          </label>
          <progress max={stats.maxHealth || 1} value={stats.health ?? 0} />
        </div>
      )}
      {stats.maxMana !== undefined && (
        <div className="vital mana">
          <label>
            Mana{' '}
            <span>
              {number(stats.mana)} / {number(stats.maxMana)}
            </span>
          </label>
          <progress max={stats.maxMana || 1} value={stats.mana ?? 0} />
        </div>
      )}
    </div>
  );
}
