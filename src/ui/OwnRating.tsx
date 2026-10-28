import { rankName, type LocalState } from '../shared/domain';
import { RankMedal } from './MatchScreen';

const statusText: Record<string, string> = {
  'waiting-account': 'Sign in to Steam and start Dota 2 from it to identify your account automatically.',
  'waiting-game': 'Account identified. Start Dota 2 to update your rating.',
  'reader-off': 'Dota memory reading is off; enable it in Settings to read your rating.',
  waiting: 'Waiting for rating data from Dota 2…',
  confirming: 'Checking current rating…',
  switching: 'Switching accounts…',
  'account-mismatch': 'Your account has changed. Restart Dota 2 with the new account.',
  'multiple-games': 'Multiple Dota 2 processes are running. Keep one open to read your rating.',
  permission: 'Could not read Dota 2. Run the game and Ancient Lens with the same permissions.',
  unsupported: 'Automatic rating reading is not available for this game version or platform.',
  unavailable: 'Game data is temporarily unavailable. We will retry automatically.',
  calibrating: 'Calibrating · exact rating is not available yet.',
};

/** States the player has to act on; routine ones (waiting, saved, calibrating) stay off the header. */
const problems = new Set(['reader-off', 'account-mismatch', 'multiple-games', 'permission', 'unsupported']);

/** The game's behavior and communication scales end at 12,000. */
const CONDUCT_MAX = 12_000;

/** Label and value on one line above a thin bar, so the number never sits on the fill. */
function Meter({
  label,
  testId,
  value,
  max,
  suffix = '',
  conduct = false,
}: {
  label: string;
  testId: string;
  value: number | null | undefined;
  max: number;
  suffix?: string;
  conduct?: boolean;
}) {
  return (
    <div className={`own-meter${conduct ? ' conduct' : ''}`} title={`${label}: ${value ?? '—'} / ${max}`}>
      <span>{label}</span>
      <strong data-testid={testId}>{value == null ? '—' : `${value.toLocaleString('en-US')}${suffix}`}</strong>
      <progress aria-label={label} max={max} value={value ?? 0} />
    </div>
  );
}

/** Medal, current MMR, confidence and conduct: the right-hand block of the profile header. */
export function OwnRating({
  local,
  rank,
}: {
  local: LocalState;
  rank: { tier?: number | null; leaderboard?: number | null; source: string };
}) {
  const own = local.ownAccount;
  const age = own ? Date.now() - Date.parse(own.observedAt) : Infinity;
  const active = own?.accountId === local.accountId && age >= 0 && age < 15_000;
  const live = active && ['measured', 'calibrating'].includes(own?.status ?? '');
  // Without a live reading, show the last saved one, marked as such rather than as current.
  const saved = live ? null : local.ratingSnapshot;
  const reading = live && own ? { ...own, mmr: own.status === 'measured' ? own.mmr : null } : saved;
  // Below 30% confidence Dota hides the rating and shows "Uncalibrated"; say the same.
  const uncalibrated =
    reading != null &&
    reading.mmr == null &&
    ((live && own?.status === 'calibrating') || (reading.confidence != null && reading.confidence < 30));
  const last = saved
    ? undefined
    : local.mmr.filter((m) => m.accountId === local.accountId && m.source === 'dota-memory').at(-1);
  const problem = own?.status && problems.has(own.status) ? statusText[own.status] : undefined;
  const origin = saved
    ? `Saved from Dota 2 · ${new Date(saved.confirmedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`
    : live
      ? 'Read from Dota 2'
      : (statusText[own?.status ?? ''] ?? 'Identifying account and rating…');
  return (
    <section className={`own-rating${saved ? ' saved' : ''}`} aria-label="Rating from Dota 2" title={origin}>
      <div className="own-rankline">
        <span className="own-profile-rank" title={rank.source}>
          <RankMedal tier={rank.tier} leaderboard={rank.leaderboard} />
        </span>
        {(reading || last) && (
          <strong
            className={`own-mmr${uncalibrated ? ' uncalibrated' : ''}`}
            data-testid="own-mmr"
            title={uncalibrated ? 'Confidence is below 30%: the game does not show a rating yet' : 'MMR'}
          >
            {uncalibrated ? 'Uncalibrated' : (reading?.mmr?.toLocaleString('en-US') ?? '—')}
          </strong>
        )}
        {(rank.tier || problem) && (
          <span className="own-rank-meta">
            {rank.tier ? (
              <span>
                {rankName(rank.tier)}
                {rank.leaderboard ? ` · #${rank.leaderboard}` : ''}
              </span>
            ) : null}
            {problem && (
              <small className="own-rating-problem" role="status">
                {problem}
              </small>
            )}
          </span>
        )}
      </div>
      <div className="own-meters">
        <Meter label="Confidence" testId="own-confidence" value={reading?.confidence} max={100} suffix="%" />
        {reading?.behaviorScore != null && reading.communicationScore != null && (
          <>
            <Meter label="Behavior" testId="own-behavior" value={reading.behaviorScore} max={CONDUCT_MAX} conduct />
            <Meter
              label="Communication"
              testId="own-communication"
              value={reading.communicationScore}
              max={CONDUCT_MAX}
              conduct
            />
          </>
        )}
      </div>
    </section>
  );
}
