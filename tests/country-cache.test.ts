import { expect, it, vi } from 'vitest';
import { countryCache } from '../src/shared/country-cache';

it('shares one lookup per player, keeps found countries longer than misses, and stays bounded', async () => {
  let now = 0;
  const fetch = vi.fn(async (id: string) => (id === '2' ? null : `C${id}`));
  const lookup = countryCache(fetch, { found: 1000, missing: 100, max: 3, now: () => now });
  expect(await Promise.all([lookup('1'), lookup('1')])).toEqual(['C1', 'C1']);
  expect(await lookup('2')).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(2);
  // A miss is asked again soon; a found country is kept.
  now = 150;
  await lookup('1');
  await lookup('2');
  expect(fetch).toHaveBeenCalledTimes(3);
  now = 1200;
  await lookup('1');
  expect(fetch).toHaveBeenCalledTimes(4);
  // The oldest entries leave once more than `max` players were looked up.
  await lookup('3');
  await lookup('4');
  await lookup('5');
  fetch.mockClear();
  await lookup('5');
  expect(fetch).not.toHaveBeenCalled();
  await lookup('1');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('forgets a failed lookup so the next render retries it', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('EE');
  const lookup = countryCache(fetch);
  expect(await lookup('7')).toBeNull();
  expect(await lookup('7')).toBe('EE');
});
