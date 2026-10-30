import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import {
  formatDuration,
  matchWon,
  rankName,
  type Hero,
  type Match,
  type Note,
  type PlayerHistory,
} from '../shared/domain';
import { averageKda, modeName } from '../shared/history';
import { mainPosition, matchPosition } from '../shared/roles';
import { api, errorMessage } from './App';
import { Avatar, CountryFlag, Portrait, RankMedal } from './MatchScreen';
import { MatchLinks, PlayerLinks } from './PlayerLinks';
import { RoleIcon } from './Roles';
import { NoteEditor } from './NoteEditor';

type Person = { id: string; name?: string };
type Totals = { games: number; wins: number };

/** Win rate, main role and mean K/D/A of the matches shown in the card. */
export function cardStats(matches: Match[]) {
  const results = matches.map(matchWon).filter((won) => won !== null);
  return {
    games: results.length,
    wins: results.filter(Boolean).length,
    main: mainPosition(matches),
    kda: averageKda(matches),
  };
}

const percent = (wins: number, games: number) => (games ? `${Math.round((wins / games) * 100)}%` : '—');
const kda = (row: { kills?: number | null; deaths?: number | null; assists?: number | null }) =>
  [row.kills, row.deaths, row.assists].every((value) => typeof value === 'number')
    ? `${row.kills}/${row.deaths}/${row.assists}`
    : '';

/** Both teams of a recorded match: the player first, other public accounts open their card. */
export function MatchTeams({
  match,
  name,
  heroes,
  open,
}: {
  match: Match;
  name: string;
  heroes: Hero[];
  open(person: Person): void;
}) {
  const hero = (id?: number) => heroes.find((item) => item.id === id);
  const won = matchWon(match);
  const others = (match.allies?.length ?? 0) + (match.enemies?.length ?? 0);
  const row = (participant: NonNullable<Match['allies']>[number]) => {
    const label = participant.name || `ID ${participant.id}`;
    return (
      <li key={participant.id}>
        <Portrait hero={hero(participant.hero)} />
        <button
          className="link-button"
          aria-label={`Open ${label}`}
          onClick={() => open({ id: String(participant.id), name: participant.name })}
        >
          {label}
        </button>
        <small>{kda(participant)}</small>
      </li>
    );
  };
  return (
    <div className="card-teams">
      <div className="card-team own">
        <h4>Own team{won === null ? '' : won ? ' · won' : ' · lost'}</h4>
        <ul>
          <li className="card-self">
            <Portrait hero={hero(match.hero_id)} />
            <span>{name}</span>
            <small>{kda(match)}</small>
          </li>
          {match.allies?.map(row)}
        </ul>
      </div>
      <div className="card-team enemy">
        <h4>Opponents</h4>
        <ul>{match.enemies?.map(row)}</ul>
      </div>
      {!others && <p className="muted">No other public players in this match.</p>}
    </div>
  );
}

/**
 * A player's card over the match screen: profile, period summary and the full STRATZ
 * history; a match opens its teams, and a teammate's or opponent's name opens their card.
 */
export function PlayerCard({
  start,
  heroes,
  totals,
  noteOf,
  ownId,
  close,
}: {
  start: Person;
  heroes: Hero[];
  /** All-time totals of the players already loaded for the match table. */
  totals(id: string): Totals | undefined;
  noteOf(id: string): Note | undefined;
  /** The player's own account, which gets no note. */
  ownId?: string;
  close(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [stack, setStack] = useState<Person[]>([start]);
  const person = stack.at(-1)!;
  const [history, setHistory] = useState<PlayerHistory | null>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<number>();
  const request = useRef(0);
  useEffect(() => {
    dialog.current?.showModal();
    // showModal focuses the first link; the close button is the expected start.
    closeButton.current?.focus();
  }, []);
  const load = (id: string, offset: number) => {
    const token = ++request.current;
    setBusy(true);
    setError('');
    api
      .getHistory(id, offset)
      .then((value) => token === request.current && setHistory(value))
      .catch((e) => token === request.current && setError(errorMessage(e)))
      .finally(() => token === request.current && setBusy(false));
  };
  useEffect(() => {
    setHistory(undefined);
    setExpanded(undefined);
    load(person.id, 0);
  }, [person.id]);
  const matches = history?.matches ?? [];
  const stats = cardStats(matches);
  const total = totals(person.id);
  const name = person.name || history?.profile.profile?.personaname || `Player ${person.id}`;
  const note = noteOf(person.id);
  return (
    <dialog
      ref={dialog}
      className="quick-dialog"
      aria-label="Player card"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section className="player-card">
        <header className="card-head">
          {stack.length > 1 && (
            <button className="icon-button" aria-label="Back" title="Back" onClick={() => setStack(stack.slice(0, -1))}>
              <ArrowLeft size={18} />
            </button>
          )}
          <Avatar url={history?.profile.profile?.avatarfull} />
          <div className="card-who">
            <h2>
              <CountryFlag
                code={history?.profile.profile?.loccountrycode}
                source={history?.source}
                id={history ? person.id : undefined}
              />
              {name}
            </h2>
            <small>
              {history ? `${rankName(history.profile.rank_tier)} · ${history.source}` : busy ? 'Loading…' : error}
            </small>
          </div>
          <PlayerLinks id={person.id} />
          {history && <RankMedal tier={history.profile.rank_tier} leaderboard={history.profile.leaderboard_rank} />}
          <button ref={closeButton} className="icon-button" aria-label="Close" title="Close" onClick={close}>
            <X size={18} />
          </button>
        </header>
        <div className="card-stats">
          <div>
            <b>{total ? total.games.toLocaleString('en-US') : '—'}</b>
            <span>All games{total ? ` · ${percent(total.wins, total.games)}` : ''}</span>
          </div>
          <div>
            <b>
              {stats.games}
              <small className={stats.wins * 2 >= stats.games ? 'green' : 'error-text'}>
                {percent(stats.wins, stats.games)}
              </small>
            </b>
            <span>Shown matches</span>
          </div>
          <div>
            <b>
              {stats.main ? (
                <>
                  <RoleIcon position={stats.main.position} />
                  {Math.round(stats.main.share * 100)}%
                </>
              ) : (
                '—'
              )}
            </b>
            <span>Main role</span>
          </div>
          <div>
            <b>{stats.kda}</b>
            <span>Average K/D/A</span>
          </div>
        </div>
        <NoteEditor
          key={person.id}
          accountId={person.id}
          name={person.name || history?.profile.profile?.personaname || ''}
          note={note}
          self={!!ownId && person.id === ownId}
        />
        {error && history !== undefined && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="card-list-head">
          <span>Matches</span>
          <small>Click a match for its players</small>
        </div>
        <div className="card-matches">
          {matches.map((match) => {
            const won = matchWon(match);
            const hero = heroes.find((item) => item.id === match.hero_id);
            const open = expanded === match.match_id;
            return (
              <div key={match.match_id} className={open ? 'card-match open' : 'card-match'}>
                <div
                  className="card-match-row"
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? undefined : match.match_id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setExpanded(open ? undefined : match.match_id);
                    }
                  }}
                >
                  <Portrait hero={hero} />
                  <span className="card-hero">
                    {hero?.localized_name ?? `#${match.hero_id}`}
                    <small>
                      {new Date(match.start_time * 1000).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}{' '}
                      · {formatDuration(match.duration)} · {modeName(match)}
                    </small>
                  </span>
                  <span className={`card-result ${won === null ? '' : won ? 'won' : 'lost'}`}>
                    {won === null ? '—' : won ? 'W' : 'L'}
                  </span>
                  <span className="card-kda">{kda(match) || '—'}</span>
                  <RoleIcon position={matchPosition(match)} />
                  <span className="card-actions" onClick={(event) => event.stopPropagation()}>
                    <MatchLinks id={match.match_id} />
                  </span>
                </div>
                {open && (
                  <MatchTeams match={match} name={name} heroes={heroes} open={(next) => setStack([...stack, next])} />
                )}
              </div>
            );
          })}
          {history && !matches.length && (
            <p className="muted">
              {history.historyUnavailable ? 'Match history is not available for this profile.' : 'No visible matches.'}
            </p>
          )}
        </div>
        {history?.hasMore && (
          <button className="secondary card-more" disabled={busy} onClick={() => load(person.id, history.nextOffset)}>
            {busy ? 'Loading…' : 'Show 25 more'}
          </button>
        )}
      </section>
    </dialog>
  );
}
