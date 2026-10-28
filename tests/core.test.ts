import { describe, expect, it } from 'vitest';
import { accountId, draftInputSchema, matchWon, scoreDraft, type Hero } from '../src/shared/domain';

describe('Steam IDs and match outcomes', () => {
  it('normalizes Steam64 without floating-point precision loss', () => {
    expect(accountId('76561198083722517')).toBe('123456789');
    expect(accountId('https://steamcommunity.com/profiles/76561198083722517/')).toBe('123456789');
    expect(accountId(' 00123456789 ')).toBe('123456789');
  });
  it.each(['0', '-5', '4294967296', '../cache', 'https://example.com/profiles/123', '76561197960265728'])(
    'rejects invalid ID %s',
    (input) => {
      expect(() => accountId(input)).toThrow();
    },
  );
  it('interprets player slot for both teams and preserves unknown results', () => {
    expect(matchWon({ player_slot: 0, radiant_win: true })).toBe(true);
    expect(matchWon({ player_slot: 128, radiant_win: true })).toBe(false);
    expect(matchWon({ player_slot: 130, radiant_win: false })).toBe(true);
    expect(matchWon({ player_slot: 1, radiant_win: null })).toBeNull();
  });
});

describe('draft recommendations', () => {
  const heroes: Hero[] = [1, 2, 3, 4, 5].map((id) => ({
    id,
    localized_name: `Hero ${id}`,
    primary_attr: 'str',
    attack_type: 'Melee',
    roles: id === 3 ? ['Support'] : ['Carry'],
  }));
  it('inverts enemy-perspective stats, excludes picks and bans, and rejects small samples', () => {
    const result = scoreDraft(
      heroes,
      [
        [
          { hero_id: 2, games_played: 100, wins: 20 },
          { hero_id: 3, games_played: 20, wins: 0 },
          { hero_id: 4, games_played: 100, wins: 10 },
        ],
      ],
      { enemies: [1], allies: [], bans: [4], role: '' },
    );
    expect(result.map((row) => row.hero.id)).toEqual([2]);
    expect(result[0].score).toBe(65);
  });
  it('prefers complete coverage over a single favorable matchup', () => {
    const result = scoreDraft(
      heroes,
      [
        [
          { hero_id: 2, games_played: 100, wins: 40 },
          { hero_id: 3, games_played: 100, wins: 0 },
        ],
        [{ hero_id: 2, games_played: 100, wins: 40 }],
      ],
      { enemies: [1, 5], allies: [], bans: [], role: '' },
    );
    expect(result[0].hero.id).toBe(2);
    expect(result[0].coverage).toBe(2);
  });
  it('rejects duplicated hero slots', () => {
    expect(() => draftInputSchema.parse({ enemies: [1], allies: [1], bans: [], role: '' })).toThrow();
  });
});
