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
  const calibrating = own?.accountId === local.accountId && age >= 0 && age < 15000 && own.status === 'calibrating';
  if (calibrating) return { tier: null, leaderboard: null, source: 'Dota 2 is calibrating this account' };
  const tier = live && own?.mmr != null ? rankTierFromMmr(own.mmr) : null;
  if (tier)
    return {
      tier,
      leaderboard: null,
      source: 'Based on current MMR from Dota 2',
    };
  const saved = local.ratingSnapshot;
  if (saved && saved.confidence < 30 && saved.mmr == null)
    return { tier: null, leaderboard: null, source: 'Saved Dota 2 calibration reading' };
  const savedTier = saved && saved.confidence >= 30 && saved.mmr != null ? rankTierFromMmr(saved.mmr) : null;
  if (savedTier)
    return {
      tier: savedTier,
      leaderboard: null,
      source: `Based on saved MMR from Dota 2 · ${new Date(saved!.confirmedAt).toLocaleString('en-GB')}`,
    };
  return { tier: publicTier, leaderboard, source: 'Public rank from profile history' };
}
