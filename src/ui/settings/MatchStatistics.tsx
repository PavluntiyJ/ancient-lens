import { MIN_WIN_RATE } from '../../shared/draft';
import { rankBrackets, type BracketSetting } from '../../shared/rank-bracket';
import {
  setIncludeTurbo,
  setMinWinRate,
  setRankBracket,
  setRankedOnly,
  setSynergyWeight,
  useMinWinRate,
  useRankBracket,
  useStatsFilter,
  useSynergyWeight,
} from '../preferences';

const synergyStops = [0, 25, 50, 75, 100];
const minWinRateStops = [40, 45, 50, 55];

/** `suggestions` is false when the STRATZ service is not configured: pick suggestions need it. */
export function MatchStatisticsSettings({ suggestions }: { suggestions?: boolean }) {
  const statsFilter = useStatsFilter();
  const synergyWeight = useSynergyWeight();
  const minWinRate = useMinWinRate();
  const rankBracket = useRankBracket();
  return (
    <section className="panel stats-preferences" id="settings-statistics">
      <h2>Match statistics</h2>
      <label>
        <input
          type="checkbox"
          checked={statsFilter.mode === 'all'}
          onChange={(event) => setIncludeTurbo(event.target.checked)}
        />{' '}
        Include Turbo
      </label>
      <p className="fine-print">
        Adds Turbo games to roster statistics and the profile table. Reloads roster statistics.
      </p>
      <label>
        <input
          type="checkbox"
          checked={statsFilter.rankedOnly}
          onChange={(event) => setRankedOnly(event.target.checked)}
        />{' '}
        Ranked statistics only
      </label>
      <p className="fine-print">
        Leaves unranked matchmaking out of roster statistics; the profile keeps its own filters. Reloads roster
        statistics.
      </p>
      <label className="field-label">
        Rank for hero statistics
        <select value={rankBracket} onChange={(event) => setRankBracket(event.target.value as BracketSetting)}>
          <option value="auto">Automatic</option>
          {rankBrackets.map((bracket) => (
            <option key={bracket.id} value={bracket.id}>
              {bracket.name}
            </option>
          ))}
          <option value="ALL">All ranks</option>
        </select>
      </label>
      <p className="fine-print">
        Matchups, pick recommendations and meta picks use STRATZ statistics of this rank. Automatic follows the median
        rank of the match's players, or your own rank when they are unknown, and keeps it for the match. Divine and
        Immortal are one group in STRATZ. A narrow rank has fewer games, so rare pairs show less data.
      </p>
      <div className={`synergy-setting${suggestions === false ? ' disabled' : ''}`}>
        <label htmlFor="synergy-weight">Synergy weight: {synergyWeight}%</label>
        <input
          id="synergy-weight"
          type="range"
          min="0"
          max="100"
          step="5"
          list="synergy-stops"
          aria-label="Synergy weight"
          aria-describedby="synergy-note"
          value={synergyWeight}
          disabled={suggestions === false}
          onChange={(event) => setSynergyWeight(Number(event.target.value))}
        />
        <datalist id="synergy-stops">
          {synergyStops.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <div className="range-stops" aria-hidden="true">
          {synergyStops.map((value) => (
            <button
              key={value}
              type="button"
              tabIndex={-1}
              disabled={suggestions === false}
              className={synergyWeight === value ? 'active' : undefined}
              onClick={() => setSynergyWeight(value)}
            >
              {value}%
            </button>
          ))}
        </div>
        <p className="fine-print" id="synergy-note">
          {suggestions === false
            ? 'Unavailable: pick suggestions and lane totals need STRATZ (Settings → Connections → STRATZ).'
            : 'How much allies count in pick suggestions and the Lanes total. Re-scores loaded data without reloading.'}
        </p>
      </div>
      <div className={`synergy-setting${suggestions === false ? ' disabled' : ''}`}>
        <label className={suggestions === false ? 'disabled' : undefined}>
          <input
            type="checkbox"
            checked={minWinRate.enabled}
            disabled={suggestions === false}
            aria-describedby="min-win-rate-note"
            onChange={(event) => setMinWinRate({ ...minWinRate, enabled: event.target.checked })}
          />{' '}
          Minimum hero win rate for suggestions: {minWinRate.value}%
        </label>
        <input
          type="range"
          min={MIN_WIN_RATE.min}
          max={MIN_WIN_RATE.max}
          step="1"
          aria-label="Minimum hero win rate for suggestions"
          aria-describedby="min-win-rate-note"
          value={minWinRate.value}
          disabled={suggestions === false || !minWinRate.enabled}
          onChange={(event) => setMinWinRate({ ...minWinRate, value: Number(event.target.value) })}
        />
        <div className={`range-stops${minWinRate.enabled ? '' : ' off'}`} aria-hidden="true">
          {minWinRateStops.map((value) => (
            <button
              key={value}
              type="button"
              tabIndex={-1}
              disabled={suggestions === false || !minWinRate.enabled}
              className={minWinRate.value === value ? 'active' : undefined}
              onClick={() => setMinWinRate({ ...minWinRate, value })}
            >
              {value}%
            </button>
          ))}
        </div>
        <p className="fine-print" id="min-win-rate-note">
          Hides suggested heroes whose win rate in that position is not above the threshold. Off by default.
        </p>
      </div>
    </section>
  );
}
