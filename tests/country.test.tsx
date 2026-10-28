import { readdirSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { country } from '../src/shared/country';
import { profileSchema } from '../src/shared/domain';
import { CountryFlag } from '../src/ui/MatchScreen';

vi.mock('../src/ui/App', () => ({ api: {}, errorMessage: String }));

it('names a set Steam country and ignores missing or unknown codes', () => {
  expect(country('de')).toEqual({ code: 'DE', name: 'Germany', flag: './flags/DE.svg' });
  expect(country('UA')?.name).toBe('Ukraine');
  for (const missing of [undefined, null, '', ' ', 'D', 'DEU', '1A', 'ZZ', 'GB-SCT', '../x'])
    expect(country(missing)).toBeUndefined();
});

it('bundles a flag for every two-letter code it accepts', () => {
  const files = readdirSync('public/flags')
    .filter((file) => file.endsWith('.svg'))
    .map((file) => file.slice(0, -4));
  expect(files.length).toBeGreaterThan(240);
  for (const code of files) expect(country(code)?.flag).toBe(`./flags/${code}.svg`);
});

it('keeps the profile country from either provider and draws no flag without one', () => {
  const parsed = profileSchema.parse({ profile: { account_id: 1, loccountrycode: 'SE' } });
  expect(parsed.profile?.loccountrycode).toBe('SE');
  expect(profileSchema.parse({ profile: { account_id: 1, loccountrycode: null } }).profile?.loccountrycode).toBeNull();
  const html = renderToStaticMarkup(<CountryFlag code="se" source="STRATZ" id="1" />);
  expect(html).toContain('src="./flags/SE.svg"');
  expect(html).toContain('title="Country: Sweden · Steam profile via STRATZ"');
  expect(renderToStaticMarkup(<CountryFlag code={null} />)).toBe('');
  expect(renderToStaticMarkup(<CountryFlag code="XX" />)).toBe('');
});
