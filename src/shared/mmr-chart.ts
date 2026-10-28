import type { Match, MmrEntry } from './domain';
import type { MatchRating } from './rating-history';

export type ChartPoint = {
  value: number;
  /** Measurement time in Unix seconds. */
  at: number;
  source?: MmrEntry['source'];
  confidence?: number;
  /** Change from the measurement before, also when that one is outside the chart. */
  delta?: number;
};

/** The latest 50 rating measurements by measurement time, oldest first. */
export function chartPoints(entries: MmrEntry[], limit = 50): ChartPoint[] {
  const all = entries
    .map((entry) => ({
      value: entry.value,
      at: Date.parse(entry.createdAt) / 1000,
      source: entry.source,
      confidence: entry.confidence,
    }))
    .filter((point) => Number.isFinite(point.at))
    .sort((a, b) => a.at - b.at);
  return all
    .map((point, index) => ({ ...point, delta: index ? point.value - all[index - 1]!.value : undefined }))
    .slice(-limit);
}

/** Index of the point whose x is nearest to `x` (the earlier one on a tie). */
export function nearestPoint(xs: number[], x: number): number | undefined {
  let best: number | undefined;
  xs.forEach((value, index) => {
    if (best === undefined || Math.abs(value - x) < Math.abs(xs[best]! - x)) best = index;
  });
  return best;
}

const LINK_WINDOW = 6 * 3600;

/**
 * The recorded match a game measurement follows: the latest match that ended up to six
 * hours before it and whose post-match rating is this value. Manual entries have none.
 */
export function pointMatch(point: ChartPoint, matches: Match[], ratings: Map<number, MatchRating>): Match | undefined {
  if (point.source !== 'dota-memory') return undefined;
  let found: Match | undefined;
  for (const match of matches) {
    const end = match.start_time + match.duration;
    if (end > point.at || point.at - end > LINK_WINDOW || ratings.get(match.match_id)?.mmr !== point.value) continue;
    if (!found || end > found.start_time + found.duration) found = match;
  }
  return found;
}

/** Consecutive points of one local day, for the day bands under a one-step-per-match chart. */
export function dayBands(times: number[]): { from: number; to: number; label: string; count: number }[] {
  const bands: { from: number; to: number; label: string; count: number }[] = [];
  times.forEach((at, index) => {
    const day = new Date(at * 1000);
    const label = day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const last = bands.at(-1);
    if (last && last.label === label && new Date(times[last.from]! * 1000).toDateString() === day.toDateString()) {
      last.to = index;
      last.count++;
    } else bands.push({ from: index, to: index, label, count: 1 });
  });
  return bands;
}
