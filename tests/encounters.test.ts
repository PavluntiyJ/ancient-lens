import { expect, it } from 'vitest';
import type { Note } from '../src/shared/domain';
import { Announcer, notedPlayers } from '../src/shared/encounters';

const note = (accountId: string, tag: Note['tag']): Note => ({ accountId, name: '', text: 'x', tag, updatedAt: '' });

it('finds players with a note, "Watch out" ones as avoid, never the own account', () => {
  const found = notedPlayers(['1', '55', '66', '88', '99'], '1', [
    note('66', 'avoid'),
    note('88', 'teammate'),
    note('55', 'neutral'),
    note('1', 'avoid'),
  ]);
  expect(found).toEqual(
    new Map([
      ['55', 'note'],
      ['66', 'avoid'],
      ['88', 'note'],
    ]),
  );
});

it('announces each player once per match, and players seen without a note stay quiet', () => {
  const announcer = new Announcer();
  expect(announcer.next('9', ['55', '66'], new Map([['55', 'note']]))).toBe('note');
  expect(announcer.next('9', ['55', '66'], new Map([['55', 'note']]))).toBeUndefined();
  // A note written during the match does not ring at once.
  expect(announcer.next('9', ['55', '66'], new Map([['66', 'avoid']]))).toBeUndefined();
  // A player who appears later in the same match still can.
  expect(announcer.next('9', ['55', '66', '77'], new Map([['77', 'avoid']]))).toBe('avoid');
  // Another match, then back: the noted players ring again; "avoid" wins.
  expect(announcer.next('10', ['11'], new Map())).toBeUndefined();
  expect(
    announcer.next(
      '9',
      ['55', '66'],
      new Map([
        ['55', 'note'],
        ['66', 'avoid'],
      ]),
    ),
  ).toBe('avoid');
});
