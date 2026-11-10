import { RefreshCw } from 'lucide-react';
import type { LiveState, StatsDays } from '../../shared/domain';

const phaseNames: Record<string, string> = {
  DOTA_GAMERULES_STATE_HERO_SELECTION: 'Hero selection',
  DOTA_GAMERULES_STATE_STRATEGY_TIME: 'Strategy',
  DOTA_GAMERULES_STATE_PRE_GAME: 'Pre-game',
  DOTA_GAMERULES_STATE_GAME_IN_PROGRESS: 'Match in progress',
  DOTA_GAMERULES_STATE_POST_GAME: 'Match finished',
  DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD: 'Loading players',
};

/**
 * The match status (phase or last match, match ID), profile progress, the statistics period
 * and refresh. It sits in the window's title bar.
 */
export function MatchToolbar({
  online,
  suspended,
  lingering,
  connected,
  mode,
  phase,
  match,
  anonymousDraft,
  loaded,
  total,
  privateProfiles,
  updating,
  days,
  setDays,
  onRelease,
  onRefresh,
}: {
  /** The game is sending this match now. */
  online: boolean;
  /** A running match waits for a reconnect. */
  suspended: boolean;
  /** The last match stays on screen after leaving it. */
  lingering: boolean;
  connected: boolean;
  mode: LiveState['mode'];
  phase?: string;
  match: string;
  anonymousDraft: boolean;
  /** Profiles loaded, of `total` accounts. */
  loaded: number;
  total: number;
  privateProfiles: number;
  updating: boolean;
  days: StatsDays;
  setDays(days: StatsDays): void;
  /** Clears the last match. */
  onRelease(): void;
  onRefresh(): void;
}) {
  return (
    <div className="match-toolbar">
      <div>
        <span className={`dot ${online ? 'online' : suspended ? 'reconnecting' : ''}`} />
        <strong
          title={
            lingering ? 'You left this match. Its roster stays until you play or spectate another one.' : undefined
          }
        >
          {lingering
            ? mode === 'spectator'
              ? 'Last spectated match'
              : 'Last match'
            : (phaseNames[phase ?? ''] ?? (connected ? 'Game data' : 'Waiting for a match'))}
        </strong>
        <span className="match-id">{match && match !== '0' ? `#${match}` : 'DOTA 2'}</span>
        {lingering && (
          <button className="link-button" onClick={onRelease}>
            Clear
          </button>
        )}
      </div>
      {/* Roster status and period live here, not in a caption row: every row of height
        counts for keeping the ten players and the analysis panels on screen together. */}
      <div>
        <span className="roster-status">
          {anonymousDraft
            ? 'Anonymous draft'
            : `Profiles · ${loaded}/${total} loaded${privateProfiles ? ` · ${privateProfiles} private` : ''}`}
        </span>
        {updating && <small role="status">Updating…</small>}
        <select
          aria-label="Statistics period"
          value={days}
          onChange={(event) => {
            const value = Number(event.target.value) as StatsDays;
            localStorage.setItem('stats-days', String(value));
            setDays(value);
          }}
        >
          {[7, 14, 30, 90].map((value) => (
            <option key={value} value={value}>
              {value} days
            </option>
          ))}
        </select>
        {mode === 'spectator' && <span className="badge">SPECTATOR</span>}
        <button className="icon-button" aria-label="Refresh match statistics" disabled={!connected} onClick={onRefresh}>
          <RefreshCw size={15} />
        </button>
      </div>
    </div>
  );
}
