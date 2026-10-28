import { expect, it } from 'vitest';
import { formatImp, impTier } from '../src/shared/performance';

it('maps IMP to seven tones at the band edges', () => {
  const edges: [number, number][] = [
    [-60, 0],
    [-41, 0],
    [-40, 1],
    [-26, 1],
    [-25, 2],
    [-11, 2],
    [-10, 3],
    [0, 3],
    [10, 3],
    [11, 4],
    [25, 4],
    [26, 5],
    [40, 5],
    [41, 6],
    [80, 6],
  ];
  for (const [imp, tier] of edges) expect(impTier(imp), String(imp)).toBe(tier);
  // Rounded like the displayed number, so the colour never disagrees with the label.
  expect(impTier(10.4)).toBe(3);
  expect(impTier(10.6)).toBe(4);
});

it('leaves a missing IMP without a tone instead of calling it average', () => {
  for (const value of [null, undefined, Number.NaN, Infinity]) expect(impTier(value)).toBeNull();
  expect([formatImp(12), formatImp(-7), formatImp(0)]).toEqual(['+12', '−7', '0']);
});
