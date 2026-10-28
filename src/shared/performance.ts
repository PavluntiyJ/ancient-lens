/**
 * STRATZ IMP (Individual Match Performance): 0 is an average game. Seven tones in the order
 * of the XVM rating scale, from very bad to outstanding. The bands are an Ancient Lens choice
 * measured on 790 player-games of Divine matches: about a third of games stay average, 4% are
 * very poor and 2% outstanding. They are not a STRATZ classification.
 */
export const impTiers = [
  { max: -41, label: 'Very poor' },
  { max: -26, label: 'Poor' },
  { max: -11, label: 'Below average' },
  { max: 10, label: 'Average' },
  { max: 25, label: 'Good' },
  { max: 40, label: 'Very good' },
  { max: Infinity, label: 'Outstanding' },
] as const;

/** Tier index 0–6, or null for a missing or non-finite value (never treated as average). */
export function impTier(imp: number | null | undefined): number | null {
  if (typeof imp !== 'number' || !Number.isFinite(imp)) return null;
  const value = Math.round(imp);
  return impTiers.findIndex((tier) => value <= tier.max);
}

export function formatImp(imp: number): string {
  const value = Math.round(imp);
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0';
}
