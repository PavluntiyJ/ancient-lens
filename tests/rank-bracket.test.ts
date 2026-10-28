import { expect, it } from 'vitest';
import { bracketName, bracketOfMmr, bracketOfTier, chooseBracket, matchMedalTier } from '../src/shared/rank-bracket';

it('maps medals and MMR to the STRATZ basic brackets', () => {
  expect([11, 25, 31, 45, 52, 65, 75, 80].map(bracketOfTier)).toEqual([
    'HERALD_GUARDIAN',
    'HERALD_GUARDIAN',
    'CRUSADER_ARCHON',
    'CRUSADER_ARCHON',
    'LEGEND_ANCIENT',
    'LEGEND_ANCIENT',
    'DIVINE_IMMORTAL',
    'DIVINE_IMMORTAL',
  ]);
  expect([0, null, undefined, 9, 95].map(bracketOfTier)).toEqual([
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
  expect([800, 2000, 4000, 4700, 9000].map(bracketOfMmr)).toEqual([
    'HERALD_GUARDIAN',
    'CRUSADER_ARCHON',
    'LEGEND_ANCIENT',
    'DIVINE_IMMORTAL',
    'DIVINE_IMMORTAL',
  ]);
  expect(bracketOfMmr(null)).toBeUndefined();
  expect(bracketName('ALL')).toBe('All ranks');
  expect(bracketName('DIVINE_IMMORTAL')).toBe('Divine – Immortal');
});

it('follows the match median, then the own rank, then all ranks; a fixed setting wins', () => {
  const match = { matchTiers: [80, 80, 75, 52, null], ownTier: 31 };
  expect(chooseBracket('auto', match)).toEqual({ bracket: 'DIVINE_IMMORTAL', source: 'match' });
  // Fewer than three ranked players: the own medal, else the own MMR.
  expect(chooseBracket('auto', { matchTiers: [80, 0], ownTier: 31 })).toEqual({
    bracket: 'CRUSADER_ARCHON',
    source: 'own',
  });
  expect(chooseBracket('auto', { matchTiers: [], ownMmr: 6200 })).toEqual({
    bracket: 'DIVINE_IMMORTAL',
    source: 'own',
  });
  expect(chooseBracket('auto', { matchTiers: [] })).toEqual({ bracket: 'ALL', source: 'none' });
  expect(chooseBracket('LEGEND_ANCIENT', match)).toEqual({ bracket: 'LEGEND_ANCIENT', source: 'setting' });
  expect(chooseBracket('ALL', match)).toEqual({ bracket: 'ALL', source: 'setting' });
});

it('takes the median medal of a match from three known ones', () => {
  expect(matchMedalTier([75, null, 54, 80, undefined, 0])).toBe(75);
  expect(matchMedalTier([75, 54])).toBeUndefined();
  expect(matchMedalTier([91, 75, 54, 33])).toBe(54);
});
