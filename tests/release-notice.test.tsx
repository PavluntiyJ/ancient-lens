import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { releaseNotice } from '../src/shared/release-notice';
import { ReleaseNotice } from '../src/ui/ReleaseNotice';
import { UpdateSettings } from '../src/ui/settings/UpdateSettings';
import type { LocalState, ReleaseInfo } from '../src/shared/domain';

vi.mock('../src/ui/App', () => ({
  api: { setUpdateCheck: () => Promise.resolve(), openRelease: () => Promise.resolve('') },
  errorMessage: String,
  Notice: () => null,
}));

const local: LocalState = { accountId: '', notes: [], mmr: [] };
const info: ReleaseInfo = {
  current: '0.6.1',
  latest: {
    version: '0.7.0',
    url: 'https://github.com/PavluntiyJ/ancient-lens/releases/tag/v0.7.0',
    prerelease: true,
    publishedAt: '2026-11-02T10:00:00Z',
  },
};

describe('new-version notice', () => {
  it('announces a newer release until it is skipped, put off or the check is off', () => {
    expect(releaseNotice(info, local, null)?.version).toBe('0.7.0');
    expect(releaseNotice(info, { updateCheck: true, skippedVersion: '0.6.2' }, null)?.version).toBe('0.7.0');
    expect(releaseNotice(info, { skippedVersion: '0.7.0' }, null)).toBeNull();
    expect(releaseNotice(info, local, '0.7.0')).toBeNull();
    expect(releaseNotice(info, { updateCheck: false }, null)).toBeNull();
    // Before a check finished, or when it found nothing newer.
    expect(releaseNotice(undefined, local, null)).toBeNull();
    expect(releaseNotice({ current: '0.6.1', latest: null }, local, null)).toBeNull();
  });

  it('names both versions and offers the release page, Later and Skip', () => {
    const html = renderToStaticMarkup(
      <ReleaseNotice release={info.latest!} current="0.6.1" open={() => {}} later={() => {}} skip={() => {}} />,
    );
    expect(html).toContain('<b>Ancient Lens 0.7.0</b> (prerelease) is out; you have 0.6.1.');
    expect([...html.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((m) => m[1])).toEqual([
      'What&#x27;s new',
      'Later',
      'Skip this version',
    ]);
  });

  it('settings show the switch, what is sent and the newest release', () => {
    const on = renderToStaticMarkup(<UpdateSettings local={local} update={() => {}} release={info} />);
    expect(on).toMatch(/type="checkbox" checked=""/);
    expect(on).toContain('GitHub sees your IP address');
    expect(on).toContain('Newest release: <b>0.7.0</b> (prerelease).');
    const off = renderToStaticMarkup(
      <UpdateSettings local={{ ...local, updateCheck: false }} update={() => {}} release={info} />,
    );
    expect(off).not.toMatch(/checked=""/);
    expect(off).toContain('Checking is off.');
    expect(off).not.toContain('0.7.0');
    const none = renderToStaticMarkup(
      <UpdateSettings local={local} update={() => {}} release={{ current: '0.6.1', latest: null }} />,
    );
    expect(none).toContain('You have 0.6.1. No newer release is known.');
  });
});
