import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProBadge } from '../src/ui/MatchScreen';
import { profileSchema } from '../src/shared/domain';

vi.mock('../src/ui/App', () => ({ api: {}, errorMessage: String }));

it('names the professional and where the name comes from', () => {
  const html = renderToStaticMarkup(<ProBadge name="FixturePro" />);
  expect(html).toContain('class="pro-badge"');
  expect(html).toContain('title="Professional player FixturePro · name from STRATZ"');
  expect(html).toContain('role="img"');
});

it('keeps the professional name from a profile and leaves it absent otherwise', () => {
  const parsed = profileSchema.parse({ profile: { account_id: 1, personaname: 'Persona', pro_name: 'FixturePro' } });
  expect(parsed.profile?.pro_name).toBe('FixturePro');
  expect(profileSchema.parse({ profile: { account_id: 1 } }).profile?.pro_name).toBeUndefined();
});
