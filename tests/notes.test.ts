import { expect, it } from 'vitest';
import type { Match, Note } from '../src/shared/domain';
import { meetings } from '../src/shared/meetings';
import { filterNotes, noteMatch, noteWhen } from '../src/shared/notes';

const match = (id: number, extra: Partial<Match>): Match => ({
  match_id: id,
  hero_id: 2,
  start_time: id,
  duration: 1800,
  player_slot: 0,
  radiant_win: true,
  ...extra,
});
const history = [
  match(1, { allies: [{ id: 55, hero: 38 }] }),
  match(2, { player_slot: 130, radiant_win: true, enemies: [{ id: 66, hero: 34 }] }),
  // STRATZ lineup only: the player's side compared with the own slot.
  match(3, { player_slot: 0, lineup: [{ radiant: false, id: 77, hero_id: 93 }] }),
];

it('takes the own hero and result from the history and the rest from the note when the match is not saved', () => {
  expect(noteMatch({ id: 'a', text: 'x', at: '', matchId: 1 }, '55', history)).toEqual({
    matchId: 1,
    known: true,
    ownHeroId: 2,
    won: true,
    heroId: 38,
    ally: true,
  });
  expect(noteMatch({ id: 'a', text: 'x', at: '', matchId: 2 }, '66', history)).toMatchObject({
    won: false,
    heroId: 34,
    ally: false,
  });
  expect(noteMatch({ id: 'a', text: 'x', at: '', matchId: 3 }, '77', history)).toMatchObject({
    heroId: 93,
    ally: false,
  });
  expect(noteMatch({ id: 'a', text: 'x', at: '', matchId: 9, heroId: 71, ally: true }, '55', history)).toEqual({
    matchId: 9,
    known: false,
    ownHeroId: undefined,
    won: null,
    heroId: 71,
    ally: true,
  });
  expect(noteMatch({ id: 'a', text: 'x', at: '' }, '55', history)).toBeUndefined();
});

it('filters players by side, general notes and a search over names, IDs, notes, matches and heroes', () => {
  const note = (accountId: string, name: string, entries: Note['entries']): Note => ({
    accountId,
    name,
    entries,
    text: entries[0]!.text,
    updatedAt: '',
  });
  const notes = [
    note('55', 'Fenrir', [{ id: '1', text: 'Plays for the team', at: '', matchId: 1 }]),
    note('66', 'noobmaster', [
      { id: '2', text: 'Party with Fenrir', at: '' },
      { id: '3', text: 'Ban the hero', at: '', matchId: 2, heroId: 34 },
    ]),
    // Met only in a live match that is not saved yet: the side comes from the note.
    note('88', 'Kestrel', [{ id: '4', text: 'Calls smokes', at: '', matchId: 99, ally: true }]),
  ];
  const met = (id: string) => meetings(history, id);
  const heroName = (id: number) => (id === 34 ? 'Tinker' : undefined);
  const ids = (query: string, filter: Parameters<typeof filterNotes>[2] = 'all') =>
    filterNotes(notes, query, filter, met, heroName).map((item) => item.accountId);
  expect(ids('')).toEqual(['55', '66', '88']);
  expect(ids('', 'ally')).toEqual(['55', '88']);
  expect(ids('', 'enemy')).toEqual(['66']);
  expect(ids('', 'general')).toEqual(['66']);
  expect(ids('fenrir')).toEqual(['55', '66']);
  expect(ids('tinker')).toEqual(['66']);
  expect(ids('99')).toEqual(['88']);
  expect(ids('calls SMOKES')).toEqual(['88']);
  expect(ids('fenrir', 'ally')).toEqual(['55']);
});

it('dates notes as today, yesterday or the day', () => {
  const now = new Date('2026-11-06T12:00:00');
  expect(noteWhen('2026-11-06T01:18:00', now)).toBe('Today 01:18');
  expect(noteWhen('2026-11-05T23:31:00', now)).toBe('Yesterday 23:31');
  expect(noteWhen('2026-10-28T12:40:00', now)).toBe('Oct 28');
  expect(noteWhen('2025-10-28T12:40:00', now)).toBe('Oct 28, 2025');
  expect(noteWhen('not a date', now)).toBe('');
});
