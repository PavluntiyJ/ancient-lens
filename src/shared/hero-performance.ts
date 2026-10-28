// Sample thresholds decide the band; intensity within each band is presentation.
// A tiny sample is deliberately neutral.
export function heroPerformance(wins: number, games: number) {
  if (!Number.isFinite(wins) || !Number.isFinite(games) || games < 5 || wins < 0 || wins > games)
    return { tone: 'neutral', intensity: 0 } as const;
  const rate = (wins / games) * 100;
  const positive = rate >= (games >= 10 ? 60 : 80);
  const negative = rate <= (games >= 10 ? 40 : 20);
  return {
    tone: positive ? 'positive' : negative ? 'negative' : 'neutral',
    intensity: positive || negative ? Math.min(1, Math.abs(rate - 50) / 50) : 0,
  } as const;
}
