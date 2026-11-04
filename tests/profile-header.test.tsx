import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MmrChart, ScoreCard } from '../src/ui/profile/ProfileHeader';

vi.mock('../src/ui/MatchScreen', () => ({
  Portrait: () => <span className="portrait" />,
  Avatar: ({ url }: { url?: string }) => <img alt="Player avatar" src={url} />,
  CountryFlag: () => null,
  RankMedal: () => <span className="medal" />,
}));
vi.mock('../src/ui/App', () => ({ api: {}, errorMessage: String }));
vi.mock('../src/ui/preferences', () => ({ useDisplaySettings: () => ({ scale: 100 }) }));

it('shows the period record, its win rate and three equal cells', () => {
  const html = renderToStaticMarkup(
    <ScoreCard label="Last 30 days" wins={13} losses={21} mmrChange={-215} averageImp={1} streak="3 L" />,
  );
  expect(html).toContain('Last 30 days');
  expect(html).toContain('34 matches');
  expect(html).toContain('>13<');
  expect(html).toContain('>21<');
  expect(html).toContain('38.2%');
  expect(html).toContain('−215');
  expect(html).toContain('+1');
  expect(html).toContain('3 L');
});

it('leaves unknown summary values as dashes', () => {
  const html = renderToStaticMarkup(<ScoreCard label="Last 7 days" wins={0} losses={0} />);
  expect(html).toContain('0 matches');
  expect(html).toContain('>0<');
  // MMR, IMP, streak and win rate are unknown, not zero.
  expect(html.match(/—/g)?.length).toBe(4);
});

it('keeps the chart in place without MMR readings', () => {
  const html = renderToStaticMarkup(<MmrChart points={[]} onPoint={() => {}} />);
  expect(html).toContain('mmr-chart');
  expect(html).toContain('No MMR readings yet');
});

it('draws no trend from fewer than three measured matches', () => {
  const point = (at: number, value: number) => ({ at, value, win: true, id: at });
  const html = renderToStaticMarkup(<MmrChart points={[point(1, 4000), point(2, 4025)]} onPoint={() => {}} />);
  expect(html).toContain('Trend appears from 3 matches with MMR');
  expect(html).not.toContain('<polyline');
  const full = renderToStaticMarkup(
    <MmrChart points={[point(1, 4000), point(2, 4025), point(90000, 4000)]} onPoint={() => {}} />,
  );
  expect(full).toContain('<polyline');
  expect(full).toContain('mmr-day');
});

it('keeps the full identity in its own row and labels the Steam refresh separately from history', async () => {
  const { ProfileHeader } = await import('../src/ui/profile/ProfileHeader');
  const { profileSchema } = await import('../src/shared/domain');
  const { ProfileAccounts } = await import('../src/ui/profile/ProfileAccounts');
  const local = { accountId: '123', notes: [], mmr: [] };
  const name = 'A long current nickname with spaces';
  const html = renderToStaticMarkup(
    <ProfileHeader
      local={local}
      data={{
        accountId: '123',
        source: 'OpenDota',
        fetchedAt: new Date().toISOString(),
        profile: profileSchema.parse({ profile: { account_id: 123, personaname: 'Old nickname' } }),
        matches: [],
        hasMore: false,
        nextOffset: 0,
        stale: false,
      }}
      identity={{
        accountId: '123',
        name,
        avatar: 'https://avatars.fastly.steamstatic.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_full.jpg',
        fetchedAt: new Date().toISOString(),
        source: 'Steam Community',
        stale: false,
      }}
      rank={{ tier: 80, source: 'saved MMR' }}
      busy={false}
      onRefresh={() => {}}
      chart={null}
      score={null}
      accountMenu={(name) => (
        <ProfileAccounts
          name={name}
          selected="123"
          active="123"
          accounts={['123', '456']}
          choose={() => {}}
          add={async () => {}}
          remove={async () => {}}
        />
      )}
    />,
  );
  expect(html).toContain(name);
  expect(html).not.toContain('Old nickname');
  expect(html).toContain('aria-label="Accounts"');
  expect(html).not.toContain('Change ID');
  expect(html).toMatch(/<\/h2><div class="profile-identity-status">/);
  expect(html).toContain('Steam updated just now');
});
