// @vitest-environment happy-dom
import { bridge, resetBridge } from './dom/bridge';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LocalState, Note } from '../src/shared/domain';
import { NoteEditor } from '../src/ui/NoteEditor';

afterEach(() => {
  cleanup();
  resetBridge();
});

const now = new Date('2026-11-06T12:00:00');
const earlier: Note = {
  accountId: '55',
  name: 'Fenrir',
  text: 'Left at minute 20',
  updatedAt: '2026-10-28T12:40:00',
  entries: [{ id: 'a', text: 'Left at minute 20', at: '2026-10-28T12:40:00' }],
};
const stateWith = (note: Note): LocalState => ({ accountId: '1', notes: [note], mmr: [] });

it('adds a note for the live match through the bridge and shows it on top at once', async () => {
  const added: Note = {
    ...earlier,
    text: 'Calls smokes',
    entries: [
      { id: 'b', text: 'Calls smokes', at: '2026-11-06T11:59:00', matchId: 8012345678, heroId: 71, ally: true },
      ...earlier.entries!,
    ],
  };
  bridge.addNote.mockResolvedValue(stateWith(added));
  render(
    <NoteEditor
      accountId="55"
      name="Fenrir"
      note={earlier}
      context={{ matchId: '8012345678', heroId: 71, ally: true }}
      now={now}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add note for this match' }));
  fireEvent.change(screen.getByLabelText('New note about Fenrir'), { target: { value: '  Calls smokes ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByLabelText('New note about Fenrir')).toBeNull());
  expect(bridge.addNote).toHaveBeenCalledTimes(1);
  expect(bridge.addNote).toHaveBeenCalledWith({
    accountId: '55',
    name: 'Fenrir',
    text: '  Calls smokes ',
    matchId: 8012345678,
    heroId: 71,
    ally: true,
  });
  const notes = screen.getAllByRole('listitem').map((item) => item.textContent);
  expect(notes[0]).toContain('Calls smokes');
  expect(notes[0]).toContain('this match');
  expect(notes[1]).toContain('Left at minute 20');
});

it('keeps the text and shows the refusal when saving fails', async () => {
  bridge.addNote.mockRejectedValue(new Error('Up to 500 notes per player are kept'));
  render(<NoteEditor accountId="55" name="Fenrir" note={earlier} now={now} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
  fireEvent.change(screen.getByLabelText('New note about Fenrir'), { target: { value: 'One more' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Up to 500 notes per player are kept');
  // Without a live match the note is general: no match, hero or side is sent.
  expect(bridge.addNote).toHaveBeenCalledWith({ accountId: '55', name: 'Fenrir', text: 'One more' });
  expect((screen.getByLabelText('New note about Fenrir') as HTMLTextAreaElement).value).toBe('One more');
});
