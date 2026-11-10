import { useEffect, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import type { Hero, LocalState, Match, Note } from '../shared/domain';
import { noteCount, noteMatch, noteWhen } from '../shared/notes';
import { api, errorMessage } from './App';
import { Portrait } from './Portrait';

/** Why there is no note about the player's own account; the store refuses one too. */
export const SELF_NOTE = 'Why would you need a note about yourself? Everybody knows you are the best.';

/** The match a card is open in: a note written there keeps it, the player's hero and side. */
export type NoteContext = { matchId?: string; heroId?: number; ally?: boolean };

/**
 * The notes of one player in a match card (hover preview or player card), newest first.
 * "Add note" puts a new note on top and never replaces an earlier one; in a live match the
 * note keeps that match. Saving updates the app state, so the table and the chime follow,
 * and the saved result shows at once: a hover card keeps the props it opened with.
 * Editing and deleting single notes is on the Notes page. The player's own account gets
 * no editor, only a compliment under the pointer.
 */
export function NoteEditor({
  accountId,
  name,
  note: given,
  self = false,
  heroes = [],
  history = [],
  context,
  openNotes,
  now = new Date(),
}: {
  accountId: string;
  name: string;
  note?: Note;
  self?: boolean;
  heroes?: Hero[];
  /** The own saved history: the own hero and the result of each note's match. */
  history?: Match[];
  context?: NoteContext;
  /** Shows the player on the Notes page. */
  openNotes?(accountId: string): void;
  now?: Date;
}) {
  const [saved, setSaved] = useState<{ note?: Note }>();
  useEffect(() => setSaved(undefined), [given]);
  const note = saved ? saved.note : given;
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const matchId = context?.matchId && context.matchId !== '0' ? Number(context.matchId) : undefined;
  const entries = note?.entries ?? [];
  const heroOf = (id?: number) => heroes.find((hero) => hero.id === id);
  const list = (
    <ol className="note-entries">
      {entries.map((entry) => {
        const match = noteMatch(entry, accountId, history);
        const hero = heroOf(match?.heroId);
        const here = !!matchId && entry.matchId === matchId;
        const meta = [
          noteWhen(entry.at, now),
          here ? 'this match' : '',
          hero ? `as ${hero.localized_name}` : '',
          match?.ally === undefined ? '' : match.ally ? 'ally' : 'enemy',
        ].filter(Boolean);
        return (
          <li key={entry.id}>
            <Portrait hero={hero} />
            <div>
              <small className="note-meta">
                {meta.join(' · ')}
                {match?.won != null && (
                  <>
                    {' · '}
                    <b className={match.won ? 'green' : 'error-text'}>{match.won ? 'Win' : 'Loss'}</b>
                  </>
                )}
              </small>
              <p>{entry.text}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
  // An older note about oneself stays readable; the Notes page can still delete it.
  if (self)
    return (
      <div className="note-thread self-note" tabIndex={0} aria-disabled="true" aria-label={SELF_NOTE}>
        {entries.length > 0 && list}
        <span className="self-note-say">
          {!entries.length && (
            <span className="note-add-hint">
              <Plus size={15} />
              Add note
            </span>
          )}
          <span className="self-note-joke">{SELF_NOTE}</span>
        </span>
      </div>
    );
  const open = () => {
    setText('');
    setError('');
    setComposing(true);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const state: LocalState = await api.addNote({
        accountId,
        name,
        text,
        ...(matchId ? { matchId, heroId: context?.heroId, ally: context?.ally } : {}),
      });
      setSaved({ note: state.notes.find((item) => item.accountId === accountId) });
      setComposing(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="note-thread">
      <div className="note-thread-head">
        <span>Your notes{entries.length > 0 && <small> · {noteCount(entries.length)}</small>}</span>
        {openNotes && entries.length > 0 && (
          <button type="button" className="text-button" onClick={() => openNotes(accountId)}>
            Open in Notes
          </button>
        )}
      </div>
      {composing ? (
        <form className="note-compose" onSubmit={(event) => void save(event)}>
          <textarea
            aria-label={`New note about ${name || 'this player'}`}
            autoFocus
            maxLength={2000}
            rows={3}
            placeholder={matchId ? 'Saved with the current match' : 'What should you remember about this player?'}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="note-compose-actions">
            <small>{entries.length ? 'Earlier notes stay; this one is added on top.' : ''}</small>
            <button type="button" className="text-button" disabled={busy} onClick={() => setComposing(false)}>
              Cancel
            </button>
            <button className="primary" disabled={busy || !text.trim()}>
              Save
            </button>
          </div>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </form>
      ) : (
        // Above the game the window is passive: the button asks for the keyboard itself, or
        // the text field it opens would show a cursor while the keys still went to the game.
        <button type="button" className="note-add" data-needs-keyboard onClick={open}>
          <Plus size={14} />
          {matchId ? 'Add note for this match' : 'Add note'}
        </button>
      )}
      {entries.length > 0 && list}
    </div>
  );
}
