import { expect, it } from 'vitest';
import { bracketPieces, findParties, partyTip, type RosterMember } from '../src/shared/parties';
import type { PartyHistory, PartyMatch } from '../src/shared/domain';

const radiant = (...ids: string[]): RosterMember[] => ids.map((accountId) => ({ accountId, team: 'radiant' }));
const dire = (...ids: string[]): RosterMember[] => ids.map((accountId) => ({ accountId, team: 'dire' }));
const roster = [...radiant('1001', '1002', '1003', '1004', '1005'), ...dire('1006', '1007', '1008', '1009', '1010')];
let nextMatch = 500;
/** A match of `owner` with the given mates and their party flags. */
const played = (mates: Record<string, boolean | null>, matchId = nextMatch++): PartyMatch => ({
  match_id: matchId,
  start_time: 1_790_000_000 + matchId,
  mates: Object.entries(mates).map(([id, party]) => ({ id, party })),
});
const history = (players: Record<string, PartyMatch[]>): PartyHistory => ({
  source: 'STRATZ',
  fetchedAt: '2026-10-30T12:00:00Z',
  players: Object.entries(players).map(([accountId, matches]) => ({ accountId, matches })),
});

it('links players who shared a STRATZ party', () => {
  const parties = findParties(roster, history({ '1001': [played({ '1002': true })] }));
  expect(parties).toEqual([
    {
      team: 'radiant',
      members: ['1001', '1002'],
      sure: true,
      links: [{ a: '1001', b: '1002', together: 1, party: 1 }],
      colour: 0,
    },
  ]);
});

it('links players twice on one team without party data as likely', () => {
  const parties = findParties(roster, history({ '1006': [played({ '1007': null }), played({ '1007': null })] }));
  expect(parties).toHaveLength(1);
  expect(parties[0]).toMatchObject({ team: 'dire', members: ['1006', '1007'], sure: false });
});

it('does not link a single shared match without party data', () => {
  expect(findParties(roster, history({ '1006': [played({ '1007': null })] }))).toEqual([]);
});

it('does not link players recorded in different parties', () => {
  const matches = [played({ '1003': null }), played({ '1003': null }), played({ '1003': false })];
  expect(findParties(roster, history({ '1001': matches }))).toEqual([]);
});

it('finds a private member through a public teammate', () => {
  const parties = findParties(roster, history({ '1001': [played({ '1002': true })], '1002': [] }));
  expect(parties[0].members).toEqual(['1001', '1002']);
});

it('chains three players into one party', () => {
  const parties = findParties(
    roster,
    history({ '1001': [played({ '1002': true })], '1003': [played({ '1002': true })] }),
  );
  expect(parties).toHaveLength(1);
  expect(parties[0].members).toEqual(['1001', '1002', '1003']);
  expect(parties[0].sure).toBe(true);
});

it('ignores the current match', () => {
  const current = played({ '1002': true }, 9000);
  expect(findParties(roster, history({ '1001': [current] }), '9000')).toEqual([]);
});

it('counts a match seen from both players once', () => {
  const shared = played({ '1002': null }, 9100);
  const mirrored: PartyMatch = { ...shared, mates: [{ id: '1001', party: null }] };
  // One shared match without party data is not enough, however many histories list it.
  expect(findParties(roster, history({ '1001': [shared], '1002': [mirrored] }))).toEqual([]);
});

it('ignores players now on the other team', () => {
  expect(findParties(roster, history({ '1001': [played({ '1006': true })] }))).toEqual([]);
});

it('numbers colours in roster order across both teams', () => {
  const parties = findParties(
    roster,
    history({ '1009': [played({ '1010': true })], '1001': [played({ '1002': true })] }),
  );
  expect(parties.map((party) => [party.members[0], party.colour])).toEqual([
    ['1001', 0],
    ['1009', 1],
  ]);
});

it('connects non-adjacent members', () => {
  const parties = findParties(roster, history({ '1001': [played({ '1002': true })] }));
  const pieces = bracketPieces(['1001', '1003', '1002', '1004', undefined], parties);
  expect(pieces).toEqual([
    [{ colour: 0, sure: true, member: true, top: true, bottom: false, lane: 0 }],
    [{ colour: 0, sure: true, member: false, top: false, bottom: false, lane: 0 }],
    [{ colour: 0, sure: true, member: true, top: false, bottom: true, lane: 0 }],
    [],
    [],
  ]);
});

it('puts an interleaved party in the second lane', () => {
  const parties = findParties(
    roster,
    history({ '1001': [played({ '1003': true })], '1002': [played({ '1004': true })] }),
  );
  const pieces = bracketPieces(['1001', '1002', '1003', '1004', '1005'], parties);
  expect(pieces.map((row) => row.map((piece) => [piece.colour, piece.lane, piece.member]))).toEqual([
    [[0, 0, true]],
    [
      [0, 0, false],
      [1, 1, true],
    ],
    [
      [0, 0, true],
      [1, 1, false],
    ],
    [[1, 1, true]],
    [],
  ]);
});

it('writes the sure and likely tips', () => {
  const names: Record<string, string> = {
    '1001': 'Kestrel',
    '1002': 'Juniper',
    '1003': 'Basalt',
    '1006': 'Moss',
    '1007': 'Fern',
  };
  const nameOf = (id: string) => names[id];
  const [sure] = findParties(
    roster,
    history({
      '1001': [played({ '1002': true }), played({ '1002': true }), played({ '1002': null })],
      '1003': [played({ '1002': true })],
    }),
  );
  expect(partyTip(sure, '1001', nameOf)).toBe(
    'Party with Juniper and Basalt: together in 3 recent matches, in one STRATZ party in 2. From public match history.',
  );
  const [likely] = findParties(
    roster,
    history({ '1006': [played({ '1007': null }), played({ '1007': null }), played({ '1007': null })] }),
  );
  expect(partyTip(likely, '1007', nameOf)).toBe(
    'Likely party with Moss: on the same team in 3 recent matches; STRATZ has no party data for them. From public match history.',
  );
});
