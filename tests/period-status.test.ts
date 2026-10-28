import { expect, it } from 'vitest';
import { periodStatus } from '../src/shared/period-status';

const day = 86_400;
it('separates a private profile from a public player who did not play', () => {
  expect(periodStatus({ isPublic: false, days: 14, lastMatchAt: null }, 0)).toEqual({ kind: 'private' });
  // STRATZ still returns some matches for part of private profiles; the period remains unknown.
  expect(periodStatus({ isPublic: false, days: 14, lastMatchAt: 30 * day }, 0)).toEqual({
    kind: 'private',
    lastMatchAt: 30 * day,
  });
  expect(periodStatus({ isPublic: true, days: 14, lastMatchAt: 30 * day }, 0)).toEqual({
    kind: 'idle',
    days: 14,
    lastMatchAt: 30 * day,
  });
  expect(periodStatus({ isPublic: true, days: 7, lastMatchAt: null }, 0)).toEqual({ kind: 'idle', days: 7 });
});
it('does not claim privacy or inactivity when the provider does not report visibility', () => {
  expect(periodStatus({ days: 14 }, 0)).toEqual({ kind: 'unknown', days: 14 });
});
it('marks visible games of a private profile as possibly incomplete', () => {
  expect(periodStatus({ isPublic: false, days: 14, lastMatchAt: 1 }, 3)).toEqual({ kind: 'games', partial: true });
  expect(periodStatus({ isPublic: true, days: 14, lastMatchAt: 1 }, 3)).toEqual({ kind: 'games', partial: false });
  expect(periodStatus({ days: 14 }, 3)).toEqual({ kind: 'games', partial: false });
});
