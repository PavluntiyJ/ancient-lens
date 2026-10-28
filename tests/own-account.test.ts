import { describe, expect, it } from 'vitest';
import { applyStateUpdate, newerLocalState, type LocalState } from '../src/shared/domain';
import { ownProfileRank, rankTierFromMmr } from '../src/shared/own-rank';

describe('account state delivery', () => {
  it('shows a local medal even when the history service has no rank', () => {
    const local: LocalState = {
      accountId: '123',
      notes: [],
      mmr: [],
      ownAccount: {
        accountId: '123',
        status: 'measured',
        source: 'dota-memory',
        observedAt: new Date(1000).toISOString(),
        mmr: 6586,
        confidence: 60,
        behaviorScore: null,
        communicationScore: null,
      },
    };
    expect(ownProfileRank(local, null, null, 2000).tier).toBe(80);
    expect(ownProfileRank(local, 65, 123, 2000).leaderboard).toBeNull();
    expect(ownProfileRank({ ...local, accountId: '456' }, null, null, 2000).tier).toBeNull();
    expect(ownProfileRank(local, 65, null, 20000).tier).toBe(65);
  });
  it('maps medal boundaries without inventing leaderboard placement', () => {
    for (const [mmr, tier] of [
      [1, 11],
      [769, 15],
      [770, 21],
      [3079, 45],
      [3080, 51],
      [4619, 65],
      [4620, 71],
      [4819, 71],
      [4820, 72],
      [5619, 75],
      [5620, 80],
      [6586, 80],
    ])
      expect(rankTierFromMmr(mmr)).toBe(tier);
    expect(rankTierFromMmr(0)).toBeNull();
  });
  it('rejects a late bootstrap or mutation response from the previous account', () => {
    const a: LocalState = { revision: 4, accountId: '123', notes: [], mmr: [] };
    const b: LocalState = { revision: 5, accountId: '456', notes: [], mmr: [] };
    expect(newerLocalState(a, b)).toBe(b);
    expect(newerLocalState(b, a)).toBe(b);
    expect(newerLocalState(b, { ...a, revision: 0 })).toBe(b);
  });
  it('merges a live-only rating update without dropping stored data', () => {
    const note = { accountId: '9', name: 'n', text: 't', tag: 'neutral', updatedAt: '' } as const;
    const base: LocalState = {
      revision: 5,
      accountId: '123',
      notes: [note],
      mmr: [{ id: 'x', value: 6586, createdAt: '' }],
    };
    const own = {
      accountId: '123',
      status: 'measured',
      source: 'dota-memory',
      observedAt: '',
      mmr: 6586,
      confidence: 59,
      behaviorScore: null,
      communicationScore: null,
    };
    const next = applyStateUpdate(base, { revision: 6, ownAccount: own });
    expect(next).toMatchObject({ revision: 6, accountId: '123', notes: [note], ownAccount: own });
    expect(next.mmr).toBe(base.mmr);
    expect(applyStateUpdate(next, { revision: 4, ownAccount: null })).toBe(next);
    expect(applyStateUpdate(next, { ...base, revision: 7 }).ownAccount).toBeUndefined();
  });
});
