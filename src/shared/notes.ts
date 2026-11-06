import { matchWon, type Match, type Note, type NoteEntry } from './domain';
import type { Meetings } from './meetings';

/**
 * The match of a note: the own hero and the result from the own saved history (provider
 * cache and match journal), the player's hero and side from that match or, for a match not
 * saved yet, from what the note kept when it was written.
 */
export type NoteMatch = {
  matchId: number;
  /** The match is in the own history. */
  known: boolean;
  ownHeroId?: number;
  won: boolean | null;
  heroId?: number;
  ally?: boolean;
};

export function noteMatch(entry: NoteEntry, accountId: string, history: Match[]): NoteMatch | undefined {
  if (!entry.matchId) return undefined;
  const match = history.find((item) => item.match_id === entry.matchId);
  const id = Number(accountId);
  const ally = match?.allies?.find((player) => player.id === id);
  const enemy = match?.enemies?.find((player) => player.id === id);
  const listed = match?.lineup?.find((player) => player.id === id);
  const ownRadiant = match ? match.player_slot < 128 : undefined;
  return {
    matchId: entry.matchId,
    known: !!match,
    ownHeroId: match?.hero_id,
    won: match ? matchWon(match) : null,
    heroId: ally?.hero ?? enemy?.hero ?? listed?.hero_id ?? entry.heroId,
    ally: ally ? true : enemy ? false : listed && ownRadiant !== undefined ? listed.radiant === ownRadiant : entry.ally,
  };
}

export type NoteFilter = 'all' | 'ally' | 'enemy' | 'general';
export const noteFilters: { id: NoteFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'ally', label: 'Met as ally' },
  { id: 'enemy', label: 'Met as enemy' },
  { id: 'general', label: 'General notes' },
];

/**
 * Players whose notes match the filter and the search. A player counts as met on a side
 * from the own history or from the side a note kept; the search looks at the name, the
 * Dota ID, the notes, their match IDs and the heroes the player had in them.
 */
export function filterNotes(
  notes: Note[],
  query: string,
  filter: NoteFilter,
  met: (accountId: string) => Meetings | null,
  heroName: (id: number) => string | undefined,
): Note[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return notes.filter((note) => {
    const seen = met(note.accountId);
    const sides = new Set(note.entries.flatMap((entry) => (entry.ally === undefined ? [] : [entry.ally])));
    if (filter === 'ally' && !(seen?.ally.games || sides.has(true))) return false;
    if (filter === 'enemy' && !(seen?.enemy.games || sides.has(false))) return false;
    if (filter === 'general' && !note.entries.some((entry) => !entry.matchId)) return false;
    if (!words.length) return true;
    const haystack = [
      note.name,
      note.accountId,
      ...note.entries.flatMap((entry) => [
        entry.text,
        entry.matchId ? String(entry.matchId) : '',
        entry.heroId ? (heroName(entry.heroId) ?? '') : '',
      ]),
    ]
      .join(' ')
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** "Today 01:18", "Yesterday 23:31", "Oct 28" or, in another year, "Oct 28, 2025". */
export function noteWhen(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** "1 note" or "3 notes". */
export function noteCount(count: number): string {
  return `${count} ${count === 1 ? 'note' : 'notes'}`;
}
