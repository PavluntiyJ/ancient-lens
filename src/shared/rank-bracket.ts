/** STRATZ basic rank brackets for hero statistics (positions, matchups, meta). Immortal alone
 * is not available there: it is grouped with Divine. */
export const rankBrackets = [
  { id: 'HERALD_GUARDIAN', name: 'Herald – Guardian' },
  { id: 'CRUSADER_ARCHON', name: 'Crusader – Archon' },
  { id: 'LEGEND_ANCIENT', name: 'Legend – Ancient' },
  { id: 'DIVINE_IMMORTAL', name: 'Divine – Immortal' },
] as const;
export type RankBracket = 'ALL' | (typeof rankBrackets)[number]['id'];
/** The Settings choice: `auto` follows the match, anything else is fixed. */
export type BracketSetting = 'auto' | RankBracket;
export type BracketChoice = { bracket: RankBracket; source: 'setting' | 'match' | 'own' | 'none' };

/** A medal (rank tier 11–80, first digit the medal) to its bracket. */
export function bracketOfTier(tier: number | null | undefined): RankBracket | undefined {
  const medal = tier ? Math.floor(tier / 10) : 0;
  if (medal < 1 || medal > 8) return undefined;
  return rankBrackets[Math.floor((medal - 1) / 2)]!.id;
}
/** Seasonal MMR to its bracket, for an own account whose medal is hidden. The medal limits
 * move a little between seasons: Crusader starts near 1540, Legend 3080, Divine 4620. */
export function bracketOfMmr(mmr: number | null | undefined): RankBracket | undefined {
  if (mmr == null || !Number.isFinite(mmr) || mmr <= 0) return undefined;
  return mmr < 1540
    ? 'HERALD_GUARDIAN'
    : mmr < 3080
      ? 'CRUSADER_ARCHON'
      : mmr < 4620
        ? 'LEGEND_ANCIENT'
        : 'DIVINE_IMMORTAL';
}

/** Ranked players a match needs before its median rank decides the bracket. */
const MATCH_MINIMUM = 3;

/** The median medal of a match's players when at least three are known. */
export function matchMedalTier(tiers: (number | null | undefined)[]): number | undefined {
  const known = tiers.filter((tier): tier is number => !!bracketOfTier(tier)).sort((a, b) => a - b);
  return known.length >= MATCH_MINIMUM ? known[Math.floor(known.length / 2)] : undefined;
}

/**
 * The bracket for a match. Automatic: the median medal of the match's players when at least
 * three are known (a spectated game of any level gets its own statistics), otherwise the
 * own medal or MMR, otherwise all ranks.
 */
export function chooseBracket(
  setting: BracketSetting,
  {
    matchTiers,
    ownTier,
    ownMmr,
  }: { matchTiers: (number | null | undefined)[]; ownTier?: number | null; ownMmr?: number | null },
): BracketChoice {
  if (setting !== 'auto') return { bracket: setting, source: 'setting' };
  const median = matchMedalTier(matchTiers);
  if (median) return { bracket: bracketOfTier(median)!, source: 'match' };
  const own = bracketOfTier(ownTier) ?? bracketOfMmr(ownMmr);
  return own ? { bracket: own, source: 'own' } : { bracket: 'ALL', source: 'none' };
}

export function bracketName(bracket: RankBracket): string {
  return rankBrackets.find((item) => item.id === bracket)?.name ?? 'All ranks';
}
