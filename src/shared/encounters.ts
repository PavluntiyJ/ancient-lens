import type { Note } from './domain';

export type Encounter = 'note' | 'avoid';

/**
 * Players of the current match with a note of the own account; a "Watch out" note marks
 * them as `avoid`. Notes are local and keyed by account ID, so private profiles count
 * too. The own account is never listed.
 */
export function notedPlayers(ids: string[], ownAccountId: string, notes: Note[]): Map<string, Encounter> {
  const found = new Map<string, Encounter>();
  for (const id of ids) {
    if (!id || id === ownAccountId) continue;
    const note = notes.find((item) => item.accountId === id);
    if (note) found.set(id, note.tag === 'avoid' ? 'avoid' : 'note');
  }
  return found;
}

/**
 * Decides when to ring: once per player while a match stays on screen, at the first look
 * at that player. Players looked at without a note stay quiet for the match, so a note
 * written during the game does not ring; switching to another match and back starts over.
 */
export class Announcer {
  private match = '';
  private seen = new Set<string>();
  next(matchId: string, ids: string[], found: Map<string, Encounter>): Encounter | undefined {
    if (matchId !== this.match) {
      this.match = matchId;
      this.seen = new Set();
    }
    const fresh = ids.filter((id) => !this.seen.has(id));
    fresh.forEach((id) => this.seen.add(id));
    const kinds = fresh.flatMap((id) => found.get(id) ?? []);
    return kinds.includes('avoid') ? 'avoid' : kinds.length ? 'note' : undefined;
  }
}
