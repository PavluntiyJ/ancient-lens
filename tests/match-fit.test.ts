import { expect, it } from 'vitest';
import { fitZoom } from '../src/ui/MatchViewport';

const base = { current: 1, host: 1000, content: 1000, stretch: 0, widthLimit: 1, ceiling: Infinity };

it('grows to fill when panels only stretch into spare space', () => {
  expect(fitZoom({ ...base, current: 0.9, host: 1100, content: 1000, stretch: 100 })).toBe(1);
});

it('shrinks by the whole content while it overflows, ignoring the stretch estimate', () => {
  // Panels 9 px above their minimum, but the page still overflows by 7 px: they are not stretching.
  expect(fitZoom({ ...base, current: 0.946, host: 1228, content: 1235, stretch: 9 })).toBe(0.939);
});

it('never returns to a zoom that overflowed', () => {
  expect(fitZoom({ ...base, current: 0.939, host: 1228, content: 1220, stretch: 30, ceiling: 0.946 })).toBe(0.944);
});

it('keeps the 90% floor and the width limit', () => {
  expect(fitZoom({ ...base, content: 3000 })).toBe(0.9);
  expect(fitZoom({ ...base, widthLimit: 0.95 })).toBe(0.95);
});

it('grows past 100% only while the panels keep their preferred height', () => {
  const wide = { ...base, widthLimit: 2 };
  // A 1440p window: panels stretched 350 px above their minimum, 100 px short of preferred.
  expect(fitZoom({ ...wide, host: 1400, content: 1400, stretch: 350, preferred: 100 })).toBe(1.216);
  // Far more room still stops at the 130% ceiling.
  expect(fitZoom({ ...wide, host: 2400, content: 2400, stretch: 1350, preferred: 100 })).toBe(1.5);
  // A 1080p window: panels at their preferred height would not fit, so it stays at 100%.
  expect(fitZoom({ ...wide, content: 1000, stretch: 60, preferred: 110 })).toBe(1);
  // Overflow or the width limit still win.
  expect(fitZoom({ ...wide, host: 1400, content: 1400, stretch: 350, preferred: 100, widthLimit: 1.1 })).toBe(1.1);
});
