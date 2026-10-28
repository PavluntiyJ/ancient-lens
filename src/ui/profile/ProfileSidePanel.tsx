import { X } from 'lucide-react';
import { formatDecimal, formatDuration, matchWon, type Hero, type Match } from '../../shared/domain';
import { modeName } from '../../shared/history';
import { killParticipation } from '../../shared/match-stats';
import { formatImp, impTier } from '../../shared/performance';
import type { MatchRating } from '../../shared/rating-history';
import { matchPosition, rankedRoles } from '../../shared/roles';
import { profileWinRateTone } from '../../shared/stat-bands';
import { Portrait } from '../MatchScreen';
import { MatchLinks } from '../PlayerLinks';

const Imp = ({ value }: { value?: number | null }) =>
  typeof value === 'number' ? (
    <span className={`imp imp-${impTier(value)}`}>{formatImp(value)}</span>
  ) : (
    <span className="muted">—</span>
  );
const Signed = ({ value }: { value: number }) => (
  <span className={value > 0 ? 'green' : value < 0 ? 'error-text' : 'muted'}>
    {`${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toLocaleString('en-US')}`}
  </span>
);
const compact = (value?: number | null) =>
  typeof value === 'number' ? (value >= 1000 ? `${formatDecimal(value / 1000)}k` : String(value)) : '—';

/** Heroes of the selection: games, W–L, average IMP and MMR change (or win rate), most played first. */
export function HeroesPanel({
  matches,
  heroes,
  ratings,
  measured,
  selectedHero,
  onHero,
}: {
  matches: Match[];
  heroes: Hero[];
  ratings: Map<number, MatchRating>;
  measured: boolean;
  selectedHero?: number;
  onHero(id: number): void;
}) {
  const rows = new Map<number, { games: number; wins: number; known: number; imp: number[]; delta: number }>();
  for (const match of matches) {
    const row = rows.get(match.hero_id) ?? { games: 0, wins: 0, known: 0, imp: [], delta: 0 };
    const won = matchWon(match);
    row.games++;
    if (won !== null) {
      row.known++;
      row.wins += Number(won);
    }
    if (typeof match.imp === 'number') row.imp.push(match.imp);
    row.delta += ratings.get(match.match_id)?.delta ?? 0;
    rows.set(match.hero_id, row);
  }
  const sorted = [...rows].sort((a, b) => b[1].games - a[1].games || a[1].delta - b[1].delta || a[0] - b[0]);
  const name = (id: number) => heroes.find((hero) => hero.id === id)?.localized_name ?? `Hero #${id}`;
  return (
    <section className="profile-side" aria-label="Heroes">
      <h3>
        Heroes <small>{matches.length} matches</small>
      </h3>
      <div className="profile-heroes" role="table">
        <div className="profile-heroes-row head" role="row">
          <span role="columnheader">Hero</span>
          <span role="columnheader" title="Games">
            G
          </span>
          <span role="columnheader">W – L</span>
          <span role="columnheader">IMP</span>
          <span role="columnheader">{measured ? 'MMR' : 'Win %'}</span>
        </div>
        {sorted.map(([id, row]) => (
          <button
            key={id}
            className={`profile-heroes-row${selectedHero === id ? ' selected' : ''}`}
            role="row"
            aria-pressed={selectedHero === id}
            onClick={() => onHero(id)}
          >
            <span className="profile-heroes-name">
              <Portrait hero={heroes.find((hero) => hero.id === id)} />
              <span>{name(id)}</span>
            </span>
            <span>{row.games}</span>
            <span>
              <span className="green">{row.wins}</span>
              <span className="muted"> – </span>
              <span className="error-text">{row.known - row.wins}</span>
            </span>
            <span>
              <Imp value={row.imp.length ? row.imp.reduce((sum, v) => sum + v, 0) / row.imp.length : undefined} />
            </span>
            <span>
              {measured ? (
                <Signed value={row.delta} />
              ) : row.known ? (
                <span className={`wr-${profileWinRateTone(row.wins, row.known)}`}>
                  {Math.round((row.wins / row.known) * 100)}%
                </span>
              ) : (
                <span className="muted">—</span>
              )}
            </span>
          </button>
        ))}
        {!sorted.length && <p className="muted">No matches.</p>}
      </div>
    </section>
  );
}

/** One match in place of the Heroes panel: result, own numbers, both teams and links. */
export function MatchDetails({
  match,
  heroes,
  rating,
  onClose,
}: {
  match: Match;
  heroes: Hero[];
  rating?: MatchRating;
  onClose(): void;
}) {
  const heroOf = (id?: number) => heroes.find((hero) => hero.id === id);
  const won = matchWon(match);
  const position = matchPosition(match);
  const kp = killParticipation(match);
  const own = match.lineup?.find((entry) => entry.own);
  const ownRadiant = own ? own.radiant : match.player_slot < 128;
  const end = match.start_time + match.duration;
  return (
    <section className="profile-side profile-match" aria-label={`Match ${match.match_id}`}>
      <h3>
        Match details <small>#{match.match_id}</small>
        <button className="icon-button" aria-label="Close match details" onClick={onClose}>
          <X size={16} />
        </button>
      </h3>
      <div className="profile-match-head">
        <Portrait hero={heroOf(match.hero_id)} />
        <div>
          <strong>{heroOf(match.hero_id)?.localized_name ?? `Hero #${match.hero_id}`}</strong>
          <small>
            {new Date(end * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {modeName(match)} ·{' '}
            {formatDuration(match.duration)}
            {position ? ` · ${rankedRoles.find((role) => role.id === position)?.name}` : ''}
          </small>
        </div>
        <div className={`profile-match-result ${won === null ? 'muted' : won ? 'green' : 'error-text'}`}>
          {won === null ? 'Result unknown' : won ? 'Win' : 'Loss'}
          {rating && (
            <small>
              {rating.mmr.toLocaleString('en-US')} (<Signed value={rating.delta} />)
            </small>
          )}
        </div>
      </div>
      <dl className="profile-match-stats">
        <div>
          <dt>K / D / A</dt>
          <dd>{[match.kills, match.deaths, match.assists].map((value) => value ?? '—').join(' / ')}</dd>
        </div>
        <div>
          <dt>KP</dt>
          <dd>{kp === undefined ? '—' : `${Math.round(kp)}%`}</dd>
        </div>
        <div>
          <dt>GPM</dt>
          <dd>{match.gold_per_min ?? '—'}</dd>
        </div>
        <div>
          <dt>IMP</dt>
          <dd>
            <Imp value={match.imp} />
          </dd>
        </div>
      </dl>
      {!!match.lineup?.length &&
        [true, false].map((radiant) => (
          <div className="profile-team" key={String(radiant)}>
            <h4>
              <span>{radiant ? 'Radiant' : 'Dire'}</span>
              {won !== null && (radiant === ownRadiant) === won && <span className="green">Victory</span>}
            </h4>
            <div className="profile-player head">
              <span />
              <span />
              <span>K/D/A</span>
              <span>NW</span>
              <span>GPM</span>
              <span>IMP</span>
            </div>
            {match
              .lineup!.filter((entry) => entry.radiant === radiant)
              .map((entry, index) => (
                <div className={`profile-player${entry.own ? ' own' : ''}`} key={index}>
                  <Portrait hero={heroOf(entry.hero_id)} />
                  <span className="profile-player-name">
                    {entry.own ? 'You' : entry.name || heroOf(entry.hero_id)?.localized_name || 'Anonymous'}
                  </span>
                  <span>{[entry.kills, entry.deaths, entry.assists].map((value) => value ?? '—').join('/')}</span>
                  <span>{compact(entry.net_worth)}</span>
                  <span>{entry.gold_per_min ?? '—'}</span>
                  <span>
                    <Imp value={entry.imp} />
                  </span>
                </div>
              ))}
          </div>
        ))}
      <footer className="profile-match-links">
        <MatchLinks id={match.match_id} />
      </footer>
    </section>
  );
}
