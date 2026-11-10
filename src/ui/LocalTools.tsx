import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import {
  accountId as parseAccountId,
  matchWon,
  type Hero,
  type LocalState,
  type Match,
  type Note,
} from '../shared/domain';
import { meetings, type Meetings } from '../shared/meetings';
import { filterNotes, noteCount, noteFilters, noteMatch, type NoteFilter } from '../shared/notes';
import { api, errorMessage, Notice } from './App';
import { Portrait } from './Portrait';
import { PlayerLinks } from './PlayerLinks';

type LocalProps = { local: LocalState; update(state: LocalState): void };

const day = (iso: string) => {
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
  });
};
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const record = (side: Meetings['ally'] | undefined) =>
  side?.games
    ? [side.wins && `${side.wins}W`, side.losses && `${side.losses}L`].filter(Boolean).join(' ') || `${side.games}×`
    : '—';

/**
 * Notes page: the players with notes beside the dossier of one of them. The dossier shows
 * how often the player was in the own saved matches, a new note (attached to the last match
 * together or to none) and every note, newest first, with its match: the player's hero and
 * side, the own hero, the match ID and the result.
 */
export function Notes({ local, update, focus }: LocalProps & { focus?: { id: string } }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<NoteFilter>('all');
  const [selected, setSelected] = useState(focus?.id ?? '');
  const [history, setHistory] = useState<Match[]>([]);
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [error, setError] = useState('');
  const accounts = [...new Set([local.accountId, ...(local.profileAccounts ?? [])].filter(Boolean))];
  // The account list is rebuilt on every render; the effect below follows its contents.
  const accountKey = accounts.join();
  useEffect(() => {
    if (focus) setSelected(focus.id);
  }, [focus]);
  useEffect(() => {
    let current = true;
    void api
      .getHeroes()
      .then((value) => current && setHeroes(value))
      .catch(() => {});
    // Notes are kept for every own account, so the saved matches of all of them count:
    // provider cache and match journal, never a new request.
    void Promise.all(
      accountKey
        .split(',')
        .filter(Boolean)
        .map((id) =>
          api
            .getHistory(id, 0, true)
            .then((value) => (value?.accountId === id ? value.matches : []))
            .catch(() => [] as Match[]),
        ),
    ).then((lists) => {
      if (!current) return;
      const seen = new Set<number>();
      setHistory(lists.flat().filter((match) => !seen.has(match.match_id) && !!seen.add(match.match_id)));
    });
    return () => {
      current = false;
    };
  }, [accountKey, local.journalRevision]);
  const met = useMemo(() => {
    const cache = new Map<string, Meetings | null>();
    return (id: string) => {
      if (!cache.has(id)) cache.set(id, meetings(history, id));
      return cache.get(id)!;
    };
  }, [history]);
  const heroOf = (id?: number) => heroes.find((hero) => hero.id === id);
  const players = filterNotes(local.notes, search, filter, met, (id) => heroOf(id)?.localized_name);
  const total = local.notes.reduce((sum, note) => sum + note.entries.length, 0);
  // A Dota ID or SteamID64 in the search starts notes about a player not listed yet.
  let typed = '';
  try {
    typed = search.trim() && /^\d+$/.test(search.trim()) ? parseAccountId(search.trim()) : '';
  } catch {
    typed = '';
  }
  const startable = typed && !accounts.includes(typed) && !local.notes.some((note) => note.accountId === typed);
  // A player the filter or the search hides gives way to the first one listed; an ID
  // without notes yet stays, to write the first note.
  const chosen = local.notes.find((item) => item.accountId === selected);
  const note = chosen && players.includes(chosen) ? chosen : chosen || !selected ? players[0] : undefined;
  const id = note?.accountId ?? (selected && !chosen && !accounts.includes(selected) ? selected : '');
  const run = async (action: () => Promise<LocalState>) => {
    setError('');
    try {
      update(await action());
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  };
  return (
    <div className="notes-page">
      <aside className="notes-players">
        <div className="notes-players-head">
          <h2>Players</h2>
          <small>
            {local.notes.length} {local.notes.length === 1 ? 'player' : 'players'} · {noteCount(total)}
          </small>
        </div>
        <label className="field-label">
          Search notes, names, IDs, heroes
          <input
            type="search"
            value={search}
            placeholder="e.g. smoke, Tinker, 9077872129"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="notes-filters" role="group" aria-label="Show players">
          {noteFilters.map((item) => (
            <button
              key={item.id}
              type="button"
              className="chip"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {startable && (
          <button type="button" className="secondary notes-start" onClick={() => setSelected(typed)}>
            <Plus size={14} />
            Start notes for player {typed}
          </button>
        )}
        <ul className="notes-player-list">
          {players.map((item) => {
            const latest = item.entries[0];
            const seen = met(item.accountId);
            const faces = item.entries
              .map((entry) => heroOf(noteMatch(entry, item.accountId, history)?.heroId))
              .filter((hero): hero is Hero => !!hero)
              .slice(0, 2);
            return (
              <li key={item.accountId}>
                <button
                  type="button"
                  aria-current={item.accountId === id ? 'true' : undefined}
                  onClick={() => setSelected(item.accountId)}
                >
                  <span className="notes-player-text">
                    <b>{item.name || `Player ${item.accountId}`}</b>
                    <span>{latest?.text}</span>
                    <small>
                      {noteCount(item.entries.length)}
                      {latest && ` · last ${day(latest.at)}`}
                      {seen && ` · met ${seen.games.length}×`}
                    </small>
                  </span>
                  <span className="notes-player-faces">
                    {faces.map((hero, index) => (
                      <Portrait key={index} hero={hero} />
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {!local.notes.length && (
          <p className="muted notes-empty">
            No notes yet. Add one from a player's card during a match, or type a Dota ID in the search.
          </p>
        )}
        {local.notes.length > 0 && !players.length && <p className="muted notes-empty">No player matches.</p>}
      </aside>
      {id ? (
        <Dossier
          key={id}
          accountId={id}
          note={note}
          met={met(id)}
          history={history}
          heroes={heroes}
          run={run}
          error={error}
        />
      ) : (
        <section className="panel notes-dossier notes-dossier-empty">
          <p className="muted">Choose a player to see your notes.</p>
        </section>
      )}
    </div>
  );
}

function Dossier({
  accountId,
  note,
  met,
  history,
  heroes,
  run,
  error,
}: {
  accountId: string;
  note?: Note;
  met: Meetings | null;
  history: Match[];
  heroes: Hero[];
  run(action: () => Promise<LocalState>): Promise<boolean>;
  error: string;
}) {
  const entries = note?.entries ?? [];
  const [composing, setComposing] = useState(!entries.length);
  const [draft, setDraft] = useState('');
  const last = met?.games[0];
  const [attach, setAttach] = useState<'last' | 'none'>('last');
  const [editing, setEditing] = useState<{ id: string; text: string }>();
  const [deleting, setDeleting] = useState('');
  const [busy, setBusy] = useState(false);
  const heroOf = (id?: number) => heroes.find((hero) => hero.id === id);
  const name = note?.name || last?.player.name || `Player ${accountId}`;
  const act = async (action: () => Promise<LocalState>) => {
    setBusy(true);
    const done = await run(action);
    setBusy(false);
    return done;
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const linked = attach === 'last' && last;
    const done = await act(() =>
      api.addNote({
        accountId,
        name: note?.name || last?.player.name || '',
        text: draft,
        ...(linked ? { matchId: last.match.match_id, heroId: last.player.hero, ally: last.ally } : {}),
      }),
    );
    if (done) {
      setDraft('');
      setComposing(false);
    }
  };
  const lastWon = last ? matchWon(last.match) : null;
  return (
    <section className="panel notes-dossier" aria-label={`Notes about ${name}`}>
      <header className="notes-dossier-head">
        <div>
          <h1>{name}</h1>
          <small>
            Dota ID {accountId}
            {entries.length > 0 && ` · first note ${day(entries.at(-1)!.at)} · ${noteCount(entries.length)}`}
          </small>
        </div>
        <PlayerLinks id={accountId} labelled />
      </header>
      <div className="notes-met">
        <div>
          <span>Met in your matches</span>
          <b>{met ? `${met.games.length}×` : '—'}</b>
        </div>
        <div>
          <span>With you</span>
          <b>{record(met?.ally)}</b>
        </div>
        <div>
          <span>Against you</span>
          <b>{record(met?.enemy)}</b>
        </div>
      </div>
      {composing ? (
        <form className="notes-compose" onSubmit={(event) => void save(event)}>
          <label className="field-label">
            New note about {name}
            <textarea
              rows={3}
              maxLength={2000}
              autoFocus
              value={draft}
              placeholder="What happened this time?"
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <div className="notes-compose-actions">
            {last && (
              <>
                <span className="muted">Attach to</span>
                <button
                  type="button"
                  className="chip"
                  aria-pressed={attach === 'last'}
                  onClick={() => setAttach('last')}
                >
                  Match {last.match.match_id} · {heroOf(last.match.hero_id)?.localized_name ?? 'your hero'}
                  {lastWon !== null && ` · ${lastWon ? 'Win' : 'Loss'}`}
                </button>
                <button
                  type="button"
                  className="chip"
                  aria-pressed={attach === 'none'}
                  onClick={() => setAttach('none')}
                >
                  No match
                </button>
              </>
            )}
            <span className="spacer" />
            {entries.length > 0 && (
              <button type="button" className="text-button" disabled={busy} onClick={() => setComposing(false)}>
                Cancel
              </button>
            )}
            <button className="primary" disabled={busy || !draft.trim()}>
              Save note
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="note-add notes-add" onClick={() => setComposing(true)}>
          <Plus size={15} />
          Add another note
        </button>
      )}
      {error && <Notice error>{error}</Notice>}
      <ol className="notes-timeline">
        {entries.map((entry) => {
          const match = noteMatch(entry, accountId, history);
          const theirs = heroOf(match?.heroId);
          const own = heroOf(match?.ownHeroId);
          return (
            <li key={entry.id}>
              <div className="notes-when">
                <span>{day(entry.at)}</span>
                <small>{time(entry.at)}</small>
              </div>
              <div className="notes-entry">
                {match ? (
                  <div className="notes-match">
                    <Portrait hero={theirs} />
                    {theirs && (
                      <span>
                        as <b>{theirs.localized_name}</b>
                      </span>
                    )}
                    {match.ally !== undefined && (
                      <span className={`side-pill ${match.ally ? 'ally' : 'enemy'}`}>
                        {match.ally ? 'ally' : 'enemy'}
                      </span>
                    )}
                    <span className="muted">·</span>
                    <a
                      href={`https://stratz.com/matches/${match.matchId}`}
                      onClick={(event) => {
                        event.preventDefault();
                        void api.openMatchSite(String(match.matchId), 'stratz').catch(() => {});
                      }}
                    >
                      {own && <Portrait hero={own} />}
                      Match {match.matchId}
                    </a>
                    {match.won !== null && (
                      <b className={match.won ? 'green' : 'error-text'}>{match.won ? 'Win' : 'Loss'}</b>
                    )}
                  </div>
                ) : (
                  <span className="muted notes-general">General note · not tied to a match</span>
                )}
                {editing?.id === entry.id ? (
                  <form
                    className="notes-edit"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void act(() => api.editNote(accountId, entry.id, editing.text)).then(
                        (done) => done && setEditing(undefined),
                      );
                    }}
                  >
                    <textarea
                      aria-label="Edit note"
                      rows={3}
                      maxLength={2000}
                      autoFocus
                      value={editing.text}
                      onChange={(event) => setEditing({ id: entry.id, text: event.target.value })}
                    />
                    <div className="notes-entry-actions">
                      <button className="primary" disabled={busy || !editing.text.trim()}>
                        Save
                      </button>
                      <button type="button" className="text-button" onClick={() => setEditing(undefined)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <p>{entry.text}</p>
                    <div className="notes-entry-actions">
                      {deleting === entry.id ? (
                        <>
                          <span className="muted">Delete this note?</span>
                          <button
                            type="button"
                            className="danger-button"
                            disabled={busy}
                            onClick={() => void act(() => api.deleteNoteEntry(accountId, entry.id))}
                          >
                            Delete
                          </button>
                          <button type="button" className="text-button" onClick={() => setDeleting('')}>
                            Keep
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => setEditing({ id: entry.id, text: entry.text })}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="text-button danger-text"
                            onClick={() => setDeleting(entry.id)}
                          >
                            Delete
                          </button>
                          {entry.editedAt && <small className="muted">edited {day(entry.editedAt)}</small>}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
