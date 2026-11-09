// @vitest-environment happy-dom
import { bridge, resetBridge } from './dom/bridge';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LocalState, Note } from '../src/shared/domain';
import { Notes } from '../src/ui/LocalTools';

const note: Note = {
  accountId: '55',
  name: 'Fenrir',
  text: 'Calls smokes',
  updatedAt: '2026-11-06T11:59:00',
  entries: [
    { id: 'b', text: 'Calls smokes', at: '2026-11-06T11:59:00' },
    { id: 'a', text: 'Left at minute 20', at: '2026-10-28T12:40:00' },
  ],
};
const local: LocalState = { accountId: '1', notes: [note], mmr: [] };

beforeEach(() => {
  bridge.getHeroes.mockResolvedValue([]);
  bridge.getHistory.mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  resetBridge();
});

// The dossier's own entry; the player list repeats the newest note's text.
const entry = (text: string) =>
  screen
    .getAllByText(text)
    .find((element) => element.closest('.notes-entry'))!
    .closest('li')!;

it('saves an edited note through the bridge and hands the new state up', async () => {
  const edited: LocalState = { ...local, revision: 2 };
  bridge.editNote.mockResolvedValue(edited);
  const update = vi.fn();
  render(<Notes local={local} update={update} focus={{ id: '55' }} />);
  fireEvent.click(within(entry('Left at minute 20')).getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Edit note'), { target: { value: 'Left at minute 25' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(edited));
  expect(bridge.editNote).toHaveBeenCalledWith('55', 'a', 'Left at minute 25');
  expect(screen.queryByLabelText('Edit note')).toBeNull();
});

it('deletes one note only after it is confirmed', async () => {
  bridge.deleteNoteEntry.mockResolvedValue(local);
  render(<Notes local={local} update={vi.fn()} focus={{ id: '55' }} />);
  fireEvent.click(within(entry('Calls smokes')).getByRole('button', { name: 'Delete' }));
  expect(bridge.deleteNoteEntry).not.toHaveBeenCalled();
  expect(within(entry('Calls smokes')).getByText('Delete this note?')).toBeTruthy();
  fireEvent.click(within(entry('Calls smokes')).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(bridge.deleteNoteEntry).toHaveBeenCalledWith('55', 'b'));
});
