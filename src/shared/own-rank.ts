import type { LocalState } from './domain';

// Medal thresholds of the current client, checked against in-game medals.
// Leaderboard placement is never inferred from MMR.
export function rankTierFromMmr(mmr: number): number | null {
  if (!Number.isInteger(mmr) || mmr <= 0 || mmr > 20000) return null;
  if (mmr >= 5620) return 80;
  if (mmr >= 4620) return 71 + Math.floor((mmr - 4620) / 200);
  const step = Math.floor(mmr / 154);
  return (Math.floor(step / 5) + 1) * 10 + (step % 5) + 1;
}
export function ownProfileRank(
  local: LocalState,
  publicTier?: number | null,
  leaderboard?: number | null,
  now = Date.now(),
) {
  const own = local.ownAccount;
  const age = own ? now - Date.parse(own.observedAt) : Infinity;
  const live =
    own?.accountId === local.accountId &&
    own.status === 'measured' &&
    age >= 0 &&
    age < 15000 &&
    (own.confidence ?? 0) >= 30;
  const tier = live && own?.mmr != null ? rankTierFromMmr(own.mmr) : null;
  if (tier)
    return {
      tier,
      leaderboard: tier === 80 && publicTier === 80 ? leaderboard : null,
      source: 'Based on current MMR from Dota 2',
    };
  return { tier: publicTier, leaderboard, source: 'Public rank from profile history' };
}
