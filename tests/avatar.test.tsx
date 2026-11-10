import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Avatar } from '../src/ui/PlayerIdentity';

vi.mock('../src/ui/App', () => ({ api: {}, errorMessage: String }));
it('accepts current Steam Fastly avatar URLs and rejects unrelated image hosts', () => {
  const url = 'https://avatars.fastly.steamstatic.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_full.jpg';
  expect(renderToStaticMarkup(<Avatar url={url} />)).toContain('alt="Player avatar"');
  expect(renderToStaticMarkup(<Avatar url={url} />)).toContain(url);
  expect(
    renderToStaticMarkup(<Avatar url={url.replace('avatars.fastly.steamstatic.com', 'example.com')} />),
  ).not.toContain('<img');
});
