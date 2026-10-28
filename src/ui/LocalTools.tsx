import { useState, type FormEvent } from 'react';
import { BookOpen, Pencil, Save, Trash2 } from 'lucide-react';
import type { LocalState, NoteInput } from '../shared/domain';
import { api, date, Empty, errorMessage, Notice, PageHeading } from './App';

type LocalProps = { local: LocalState; update(state: LocalState): void };
export function Notes({
  local,
  update,
  initialId = '',
  initialName = '',
}: LocalProps & { initialId?: string; initialName?: string }) {
  const [form, setForm] = useState<NoteInput>({ accountId: initialId, name: initialName, text: '', tag: 'neutral' });
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      update(await api.saveNote(form));
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    setError('');
    try {
      update(await api.deleteNote(id));
      setDeleting('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="REMEMBER WHAT MATTERS"
        title="Player notes"
        description="Your observations are linked to a Dota ID and stay with you even if the player changes their name."
      />
      {error && <Notice error>{error}</Notice>}
      <div className="notes-layout">
        <section className="panel">
          <div className="section-title">
            <h2>Your notebook</h2>
            <span className="badge">{local.notes.length}</span>
          </div>
          <input
            className="full-input"
            aria-label="Search notes"
            placeholder="Name, ID, or text…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {local.notes
            .filter((note) =>
              `${note.name} ${note.accountId} ${note.text}`.toLowerCase().includes(search.toLowerCase()),
            )
            .map((note) => (
              <article className="note-card" key={note.accountId}>
                <div className="section-title">
                  <div>
                    <b>{note.name || `Player ${note.accountId}`}</b>
                    <small>
                      ID {note.accountId} · {date(note.updatedAt)}
                    </small>
                  </div>
                  <span className={`tag tag-${note.tag}`}>
                    {note.tag === 'teammate' ? 'Good teammate' : note.tag === 'avoid' ? 'Watch out' : 'Observation'}
                  </span>
                </div>
                <p>{note.text}</p>
                <div className="note-actions">
                  <button
                    className="text-button"
                    onClick={() => {
                      setForm(note);
                      setSaved(false);
                    }}
                  >
                    <Pencil size={14} />
                    Edit
                  </button>
                  {deleting === note.accountId ? (
                    <>
                      <button className="danger-button" disabled={busy} onClick={() => void remove(note.accountId)}>
                        Delete note
                      </button>
                      <button className="text-button" onClick={() => setDeleting('')}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="icon-button"
                      aria-label={`Delete note ${note.accountId}`}
                      onClick={() => setDeleting(note.accountId)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </article>
            ))}
          {!local.notes.length && (
            <Empty icon={<BookOpen size={30} />} title="Good teammates are worth remembering">
              Add your first note on the right. It will appear beside that player in the statistics table.
            </Empty>
          )}
        </section>
        <form className="panel note-form" onSubmit={(e) => void save(e)}>
          <h2>Record an observation</h2>
          <label className="field-label">
            Dota ID / SteamID64
            <input
              value={form.accountId}
              required
              maxLength={160}
              onChange={(e) => {
                setForm({ ...form, accountId: e.target.value });
                setSaved(false);
              }}
              placeholder="Player ID"
            />
          </label>
          <label className="field-label">
            Name for your reference
            <input
              value={form.name}
              maxLength={80}
              onChange={(e) => {
                setForm({ ...form, name: e.target.value });
                setSaved(false);
              }}
              placeholder="Nickname or familiar name"
            />
          </label>
          <label className="field-label">
            Tag
            <select
              value={form.tag}
              onChange={(e) => {
                setForm({ ...form, tag: e.target.value as NoteInput['tag'] });
                setSaved(false);
              }}
            >
              <option value="neutral">Observation</option>
              <option value="teammate">Good teammate</option>
              <option value="avoid">Watch out</option>
            </select>
          </label>
          <label className="field-label">
            Note
            <textarea
              rows={6}
              maxLength={2000}
              value={form.text}
              required
              onChange={(e) => {
                setForm({ ...form, text: e.target.value });
                setSaved(false);
              }}
              placeholder="What should you remember next time?"
            />
          </label>
          <p className="fine-print">One note per player. Saving replaces the previous note.</p>
          <button className="primary full-width" disabled={busy}>
            <Save size={16} />
            {busy ? 'Saving…' : 'Save note'}
          </button>
          {saved && <Notice>Note saved on this computer.</Notice>}
        </form>
      </div>
    </>
  );
}
