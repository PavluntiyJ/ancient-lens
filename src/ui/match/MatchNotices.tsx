import { Settings, UserPlus } from 'lucide-react';
import type { LiveState, ReaderStatus } from '../../shared/domain';
import { readerRisk, readerRiskWindows, showReaderNotice } from '../../shared/reader-notice';
import { connectionHint, type SteamSetup } from '../../shared/steam-setup';
import type { SettingsSection } from '../settings/sections';

const rosterMessages: Partial<Record<ReaderStatus, string>> = {
  permission: 'The system denied access to Dota memory',
  disabled: 'memory reading off · using GSI',
  unsupported: 'Could not recognize the structures in this Dota version',
  'not-running': 'Waiting for Dota to start',
  'multiple-games': 'Multiple Dota processes detected',
  'waiting-entities': 'Waiting for the current match roster',
  'match-mismatch': 'Checking the current match',
  incomplete: 'Waiting for the full player roster',
  unavailable: 'Updating match roster',
  retrying: 'Retrying roster search',
};

/**
 * Notices above the table: memory access denied, no game data (with the connection and the
 * manual tools), an incomplete roster, a match waiting for a reconnect, and the memory-reading
 * offer.
 */
export function MatchNotices({
  live,
  connected,
  suspended,
  match,
  platform,
  anonymousDraft,
  playerCount,
  partialPlayerRoster,
  pickCount,
  steamSetup,
  setup,
  openTool,
  onRelease,
}: {
  live: LiveState;
  connected: boolean;
  /** A running match waits for a reconnect. */
  suspended: boolean;
  match: string;
  platform?: string;
  anonymousDraft: boolean;
  playerCount: number;
  /** A player's own match with fewer than ten players known. */
  partialPlayerRoster: boolean;
  /** Confirmed picks in the draft. */
  pickCount: number;
  steamSetup?: SteamSetup;
  setup(section?: SettingsSection): void;
  openTool?(page: 'draft' | 'roster'): void;
  /** Resets the held match. */
  onRelease(): void;
}) {
  return (
    <>
      {connected && (live.rosterStatus === 'permission' || live.draftStatus === 'permission') && (
        <div className="notice error" role="alert">
          The system denied access to Dota memory. Roster and picks from memory are unavailable; showing GSI data only.
        </div>
      )}
      {!connected ? (
        <div className="match-status" role="status">
          <div>
            <b>
              {live.status === 'error'
                ? 'Connection error'
                : live.receivedAt
                  ? 'Stale data · connection to the game interrupted'
                  : 'Waiting for data from Dota 2'}
            </b>
            <p>
              {live.error ??
                connectionHint(steamSetup) ??
                'The roster and picks will appear when the game sends them. Install the GSI configuration, add -gamestateintegration, and restart Dota 2 to connect.'}
            </p>
            {openTool && (
              <p className="match-tools">
                Without game data:{' '}
                <button type="button" className="link-button" onClick={() => openTool('draft')}>
                  Manual draft
                </button>{' '}
                ·{' '}
                <button type="button" className="link-button" onClick={() => openTool('roster')}>
                  Add players manually
                </button>
              </p>
            )}
          </div>
          <button
            className={steamSetup?.state === 'repair' ? 'primary' : 'secondary'}
            onClick={() => setup('settings-game')}
          >
            <Settings size={15} />
            {steamSetup?.state === 'repair' ? 'Fix connection' : 'Connection'}
          </button>
        </div>
      ) : !anonymousDraft && playerCount < 10 ? (
        <div className="match-status">
          <div>
            <b>
              {partialPlayerRoster
                ? `Players available: ${playerCount}/10${live.rosterStatus === 'disabled' ? (showReaderNotice(platform, live, connected) ? '' : ` · ${rosterMessages.disabled}`) : ` · ${live.gameState === 'DOTA_GAMERULES_STATE_HERO_SELECTION' ? `picks: ${pickCount} · profiles after hero selection` : ((live.rosterStatus && rosterMessages[live.rosterStatus]) ?? 'waiting for match roster')}`}`
                : `The game provided ${playerCount} of 10 players`}
            </b>
            {!partialPlayerRoster && (
              <p>Waiting for the remaining slots. Statistics load when public IDs become available.</p>
            )}
          </div>
          {openTool && (
            <button className="secondary" onClick={() => openTool('roster')}>
              <UserPlus size={15} />
              Add players manually
            </button>
          )}
        </div>
      ) : null}
      {suspended && (
        <div className="match-status reconnect-notice" role="status">
          <div>
            <b>Connection to match #{match} interrupted · waiting to reconnect</b>
            <p>
              The roster, draft, and statistics are preserved. Updates will resume when you return to this match; the
              match ends when the post-game screen is detected.
            </p>
          </div>
          <button className="secondary" onClick={onRelease}>
            Reset match
          </button>
        </div>
      )}
      {showReaderNotice(platform, live, connected) && (
        <div className="match-status reader-notice" role="status">
          <div>
            <b>The enemy roster, picks, and bans require memory reading</b>
            <details>
              <summary>What to know about the risk</summary>
              <p>{platform === 'win32' ? readerRiskWindows : readerRisk}</p>
            </details>
          </div>
          <button className="secondary" onClick={() => setup('settings-reader')}>
            <Settings size={15} />
            Enable in Settings
          </button>
        </div>
      )}
    </>
  );
}
