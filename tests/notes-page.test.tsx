import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LocalState, Note } from '../src/shared/domain';
import { Notes } from '../src/ui/LocalTools';

vi.mock('../src/ui/App', () => ({
  api: { getHeroes: () => new Promise(() => {}), getHistory: () => new Promise(() => {}) },
  errorMessage: String,
  Notice: ({ children }: { children: unknown }) => <p>{String(children)}</p>,
}));

const note = (accountId: string, name: string, entries: Note['entries']): Note => ({
  accountId,
  name,
  entries,
  text: entries[0]!.text,
  updatedAt: entries[0]!.at,
});
const local: LocalState = {
  accountId: '1',
  mmr: [],
  notes: [
    note('55', 'Fenrir', [
      { id: 'b', text: 'Played for the team', at: '2026-11-06T01:18:00', matchId: 9077872129, heroId: 71, ally: true },
      { id: 'a', text: 'Left at minute 20', at: '2026-10-28T12:40:00' },
    ]),
    note('66', 'noobmaster', [{ id: 'c', text: 'Party with Fenrir', at: '2026-11-02T10:05:00' }]),
  ],
};

it('lists the players with notes and shows the first one as a dossier', () => {
  const html = renderToStaticMarkup(<Notes local={local} update={() => {}} />);
  expect(html).toContain('2 players · 3 notes');
  for (const label of ['All', 'Met as ally', 'Met as enemy', 'General notes'])
    expect(html).toContain(`>${label}</button>`);
  expect(html).toMatch(/aria-current="true"[^>]*><span class="notes-player-text"><b>Fenrir<\/b>/);
  expect(html).toContain('2 notes · last Nov 6');
  expect(html).toContain('<h1>Fenrir</h1>');
  expect(html).toContain('Dota ID 55 · first note Oct 28 · 2 notes');
  expect(html).toContain('Add another note');
  // Newest first; a note with a match links it, a note without says so.
  expect(html.indexOf('Played for the team')).toBeLessThan(html.indexOf('Left at minute 20'));
  expect(html).toContain('Match 9077872129');
  expect(html).toContain('<span class="side-pill ally">ally</span>');
  expect(html).toContain('General note · not tied to a match');
  expect(html).toContain('>Edit</button>');
  expect(html).not.toContain('One note per player');
});

it('opens the player a match card asked for, and a new player with the editor open', () => {
  const html = renderToStaticMarkup(<Notes local={local} update={() => {}} focus={{ id: '66' }} />);
  expect(html).toContain('<h1>noobmaster</h1>');
  const fresh = renderToStaticMarkup(<Notes local={local} update={() => {}} focus={{ id: '77' }} />);
  expect(fresh).toContain('<h1>Player 77</h1>');
  expect(fresh).toContain('New note about Player 77');
  expect(fresh).not.toContain('Add another note');
});

it('says where notes come from when there are none', () => {
  const html = renderToStaticMarkup(<Notes local={{ ...local, notes: [] }} update={() => {}} />);
  expect(html).toContain('No notes yet. Add one from a player&#x27;s card during a match');
  expect(html).toContain('Choose a player to see your notes.');
});
