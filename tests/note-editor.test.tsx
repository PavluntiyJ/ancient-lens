import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Hero, Match, Note } from '../src/shared/domain';
import { NoteEditor } from '../src/ui/NoteEditor';

vi.mock('../src/ui/App', () => ({ api: {}, errorMessage: String }));

const hero = (id: number, name: string): Hero => ({
  id,
  name: `npc_dota_hero_${name.toLowerCase().replace(/ /g, '_')}`,
  localized_name: name,
  primary_attr: 'str',
  attack_type: 'Melee',
  roles: [],
});
const heroes = [hero(2, 'Axe'), hero(71, 'Spirit Breaker'), hero(38, 'Beastmaster')];
const now = new Date('2026-11-06T12:00:00');
const note: Note = {
  accountId: '55',
  name: 'Fenrir',
  text: 'Played for the team',
  updatedAt: '2026-11-06T01:18:00',
  entries: [
    { id: 'b', text: 'Played for the team', at: '2026-11-06T01:18:00', matchId: 9077872129, heroId: 71, ally: true },
    { id: 'a', text: 'Left at minute 20', at: '2026-10-28T12:40:00', matchId: 9065424813 },
  ],
};
// The second note's match is in the own history: Fenrir was an ally on Beastmaster, a win.
const history: Match[] = [
  {
    match_id: 9065424813,
    hero_id: 2,
    start_time: 0,
    duration: 2040,
    player_slot: 0,
    radiant_win: true,
    allies: [{ id: 55, hero: 38 }],
  },
];

it('lists every note newest first with its match, and adds a new one on top', () => {
  const html = renderToStaticMarkup(
    <NoteEditor accountId="55" name="Fenrir" note={note} heroes={heroes} history={history} now={now} />,
  );
  expect(html).toContain('Your notes<small> · 2 notes</small>');
  expect(html.indexOf('Played for the team')).toBeLessThan(html.indexOf('Left at minute 20'));
  // A match saved with the note, not in the history yet: hero and side from the note.
  expect(html).toContain('Today 01:18 · as Spirit Breaker · ally');
  // A match in the own history: the player's hero, side and the own result from it.
  expect(html).toMatch(/Oct 28 · as Beastmaster · ally · <b class="green">Win<\/b>/);
  expect(html).toContain('>Add note<');
  expect(html).not.toContain('Edit note');
});

it('offers a note for the live match, marks notes of it, and links to the Notes page', () => {
  const html = renderToStaticMarkup(
    <NoteEditor
      accountId="55"
      name="Fenrir"
      note={note}
      heroes={heroes}
      context={{ matchId: '9077872129', heroId: 71, ally: true }}
      openNotes={() => {}}
      now={now}
    />,
  );
  expect(html).toContain('Add note for this match');
  expect(html).toContain('Today 01:18 · this match · as Spirit Breaker');
  expect(html).toContain('Open in Notes');
  // No link before there is a note to show.
  const empty = renderToStaticMarkup(<NoteEditor accountId="55" name="Fenrir" openNotes={() => {}} />);
  expect(empty).toContain('>Add note<');
  expect(empty).not.toContain('Open in Notes');
  expect(empty).not.toContain('note-entries');
});

it('asks for the keyboard when Add note is clicked above the game', () => {
  // The button opens a text field; without the marker a passive window would focus the
  // field while the keys still go to the game.
  for (const given of [undefined, note]) {
    const html = renderToStaticMarkup(<NoteEditor accountId="55" name="Fenrir" note={given} />);
    expect(html).toMatch(/<button type="button" class="note-add" data-needs-keyboard=/);
  }
  expect(renderToStaticMarkup(<NoteEditor accountId="1" name="Me" self />)).not.toContain('data-needs-keyboard');
});

it('has no editor for the own account, only a compliment, and keeps older notes readable', () => {
  const html = renderToStaticMarkup(<NoteEditor accountId="1" name="Me" self />);
  expect(html).toContain('self-note');
  expect(html).toContain('aria-disabled="true"');
  expect(html).toContain('Everybody knows you are the best.');
  const older = renderToStaticMarkup(<NoteEditor accountId="1" name="Me" self note={{ ...note, accountId: '1' }} />);
  expect(older).toContain('Played for the team');
  expect(older).not.toContain('note-add');
  expect(older).not.toContain('Add note');
});
