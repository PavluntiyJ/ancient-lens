import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { ProfileAccounts } from '../src/ui/profile/ProfileAccounts';

// The real menu renders its contents only when open; the panel itself is what this checks.
vi.mock('../src/ui/ProfileMenu', () => ({
  ProfileMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../src/ui/App', () => ({ api: {}, errorMessage: String }));

it('offers removal for a saved account but not for the current account', () => {
  const html = renderToStaticMarkup(
    <ProfileAccounts
      name="Someone"
      selected="123"
      active="123"
      accounts={['123', '456']}
      choose={() => {}}
      add={async () => {}}
      remove={async () => {}}
    />,
  );
  expect(html).toContain('aria-label="Remove Account 456"');
  expect(html).not.toContain('aria-label="Remove Account 123"');
  expect(html).toContain('aria-label="Dota ID / SteamID64"');
});
