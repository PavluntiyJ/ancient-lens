import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReaderConsentDialog } from '../src/ui/ReaderConsent';

vi.mock('../src/ui/App', () => ({ api: {}, errorMessage: String, Notice: () => null }));

const render = (windows: boolean) =>
  renderToStaticMarkup(<ReaderConsentDialog windows={windows} update={() => {}} close={() => {}} />);

it('offers to enable reading, with the risk and the way back, and a way to decline', () => {
  const html = render(true);
  expect(html).toContain('See all ten players in your own match');
  expect(html).toContain('Enable memory reading');
  expect(html).toContain('Not now');
  expect(html).toContain('The anti-cheat response is unknown.');
  expect(html).toContain('Settings → Connections → Memory reading');
});

it('names the rating only where the Windows reader reads it', () => {
  expect(render(true)).toContain('exact MMR and rank confidence');
  expect(render(false)).not.toContain('MMR');
  expect(render(false)).toContain('process_vm_readv');
});
