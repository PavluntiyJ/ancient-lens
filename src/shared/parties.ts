import type { PartyHistory } from './domain';

export type RosterMember = { accountId: string; team: 'radiant' | 'dire' };
/** Evidence for two players: shared matches on one team, and how many of them STRATZ recorded as one party. */
export type PartyLink = { a: string; b: string; together: number; party: number };
export type Party = {
  team: 'radiant' | 'dire';
  /** In roster order. */
  members: string[];
  /** Every link was seen as one STRATZ party; otherwise the party is only likely. */
  sure: boolean;
  links: PartyLink[];
  colour: number;
};
/** One party's part of the bracket in one table row; `lane` 1 keeps an interleaved party apart. */
export type BracketPiece = {
  colour: number;
  sure: boolean;
  member: boolean;
  top: boolean;
  bottom: boolean;
  lane: 0 | 1;
};

const COLOURS = 4;

/**
 * Players of the current match who queued together, from the recent public history of
 * each one (STRATZ, reduced by the statistics service). Two players of one team are linked
 * when STRATZ recorded them in one party at least once, or when they shared a team in two
 * matches without ever being recorded in different parties. Linked players form a party.
 * No evidence means no party, not "solo". The current match never counts.
 */
export function findParties(roster: RosterMember[], history: PartyHistory | null, currentMatchId?: string): Party[] {
  if (!history) return [];
  const team = new Map(roster.map((member) => [member.accountId, member.team]));
  // Each shared match once per pair, whichever history listed it: pair → match → party flag.
  const seen = new Map<string, { a: string; b: string; matches: Map<number, boolean | null> }>();
  for (const player of history.players) {
    for (const match of player.matches) {
      if (String(match.match_id) === currentMatchId) continue;
      for (const mate of match.mates) {
        if (!team.has(player.accountId) || team.get(mate.id) !== team.get(player.accountId)) continue;
        const [a, b] = [player.accountId, mate.id].sort() as [string, string];
        const pair = seen.get(`${a},${b}`) ?? { a, b, matches: new Map<number, boolean | null>() };
        // A known verdict wins over an unrecorded one for the same match.
        if (pair.matches.get(match.match_id) == null) pair.matches.set(match.match_id, mate.party);
        seen.set(`${a},${b}`, pair);
      }
    }
  }
  const links: PartyLink[] = [];
  for (const { a, b, matches } of seen.values()) {
    const flags = [...matches.values()];
    const party = flags.filter((flag) => flag === true).length;
    const apart = flags.filter((flag) => flag === false).length;
    if (party >= 1 || (flags.length >= 2 && apart === 0)) links.push({ a, b, together: flags.length, party });
  }
  const order = roster.map((member) => member.accountId);
  const parties: Party[] = [];
  const grouped = new Set<string>();
  for (const start of order) {
    if (grouped.has(start) || !links.some((link) => link.a === start || link.b === start)) continue;
    const members = new Set([start]);
    for (let grew = true; grew;) {
      grew = false;
      for (const link of links) {
        if (members.has(link.a) !== members.has(link.b)) {
          members.add(members.has(link.a) ? link.b : link.a);
          grew = true;
        }
      }
    }
    members.forEach((id) => grouped.add(id));
    const own = links.filter((link) => members.has(link.a));
    parties.push({
      team: team.get(start)!,
      members: order.filter((id) => members.has(id)),
      sure: own.every((link) => link.party >= 1),
      links: own,
      colour: parties.length % COLOURS,
    });
  }
  return parties;
}

/** The bracket pieces of each row of one team, in display order. */
export function bracketPieces(rowIds: (string | undefined)[], parties: Party[]): BracketPiece[][] {
  const rows: BracketPiece[][] = rowIds.map(() => []);
  const spans: [number, number][] = [];
  for (const party of parties) {
    const at = rowIds.flatMap((id, index) => (id && party.members.includes(id) ? [index] : []));
    const [first, last] = [at[0], at.at(-1)];
    if (first === undefined || last === undefined || first === last) continue;
    const lane = spans.some(([from, to]) => first <= to && last >= from) ? 1 : 0;
    spans.push([first, last]);
    for (let index = first; index <= last; index++)
      rows[index]?.push({
        colour: party.colour,
        sure: party.sure,
        member: at.includes(index),
        top: index === first,
        bottom: index === last,
        lane,
      });
  }
  return rows;
}

/** The evidence for one member, from their strongest link. */
export function partyTip(party: Party, accountId: string, nameOf: (id: string) => string): string {
  const others = party.members.filter((id) => id !== accountId).map(nameOf);
  const names = others.length > 1 ? `${others.slice(0, -1).join(', ')} and ${others.at(-1)}` : others[0];
  const link = party.links
    .filter((item) => item.a === accountId || item.b === accountId)
    .sort((x, y) => y.party - x.party || y.together - x.together)[0];
  const source = 'From public match history.';
  if (!link) return `Party with ${names}. ${source}`;
  return party.sure
    ? `Party with ${names}: together in ${link.together} recent matches, in one STRATZ party in ${link.party}. ${source}`
    : `Likely party with ${names}: on the same team in ${link.together} recent matches; STRATZ has no party data for them. ${source}`;
}
