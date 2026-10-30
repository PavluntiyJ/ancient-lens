import { useEffect, useState, type FormEvent } from 'react';
import { Pencil, Plus } from 'lucide-react';
import type { LocalState, Note } from '../shared/domain';
import { api, errorMessage } from './App';

/** Why there is no note about the player's own account; the store refuses one too. */
export const SELF_NOTE = 'Why would you need a note about yourself? Everybody knows you are the best.';

/**
 * The note of one player, written from the player card or the hover preview during a match;
 * keyed by account. Saving or deleting updates the app state, so the table and the chime
 * follow. The saved result shows at once: a hover card keeps the props it opened with.
 * The player's own account gets no editor, only a compliment under the pointer.
 */
export function NoteEditor({
  accountId,
  name,
  note: given,
  self = false,
}: {
  accountId: string;
  name: string;
  note?: Note;
  self?: boolean;
}) {
  const [saved, setSaved] = useState<{ note?: Note }>();
  useEffect(() => setSaved(undefined), [given]);
  const note = saved ? saved.note : given;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = () => {
    setText(note?.text ?? '');
    setError('');
    setEditing(true);
  };
  const run = async (action: () => Promise<LocalState>) => {
    setBusy(true);
    setError('');
    try {
      const state = await action();
      setSaved({ note: state.notes.find((item) => item.accountId === accountId) });
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    void run(() => api.saveNote({ accountId, name, text, tag: 'neutral' }));
  };
  // An older note about oneself stays readable; Notes can still delete it.
  if (self)
    return (
      <div
        className={`card-note card-note-view self-note${note ? '' : ' empty'}`}
        tabIndex={0}
        aria-disabled="true"
        aria-label={SELF_NOTE}
      >
        {note && <p className="player-note">{note.text}</p>}
        <span className="self-note-say">
          {!note && (
            <span className="card-note-hint">
              <Plus size={15} />
              Add note
            </span>
          )}
          <span className="self-note-joke">{SELF_NOTE}</span>
        </span>
      </div>
    );
  // The whole block opens the editor, not only its label.
  if (!editing)
    return (
      <div
        className={`card-note card-note-view${note ? '' : ' empty'}`}
        role="button"
        tabIndex={0}
        aria-label={note ? 'Edit note' : 'Add note'}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          open();
        }}
      >
        {note && <p className="player-note">{note.text}</p>}
        <span className="card-note-hint">
          {note ? <Pencil size={14} /> : <Plus size={15} />}
          {note ? 'Edit note' : 'Add note'}
          {note?.updatedAt && (
            <small className="note-date">
              · Note of{' '}
              {new Date(note.updatedAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </small>
          )}
        </span>
      </div>
    );
  return (
    <form className="card-note card-note-form" onSubmit={save}>
      <textarea
        aria-label="Note"
        autoFocus
        maxLength={2000}
        rows={5}
        placeholder="What should you remember about this player?"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="card-note-actions">
        <button className="primary" disabled={busy || !text.trim()}>
          Save
        </button>
        <button type="button" className="text-button" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </button>
        {note && (
          <button
            type="button"
            className="danger-button"
            disabled={busy}
            onClick={() => void run(() => api.deleteNote(accountId))}
          >
            Delete
          </button>
        )}
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
