import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DraftSuggestions } from '../src/ui/DraftPanels';

vi.mock('../src/ui/MatchScreen', () => ({ Portrait: () => <span className="portrait" /> }));

const suggestions = (connect?: () => void) =>
  renderToStaticMarkup(
    <DraftSuggestions
      lane={0}
      context="test"
      weight={0.5}
      busy={false}
      error=""
      available={false}
      connect={connect}
      picked={0}
      partial={false}
    />,
  );

it('offers Connect STRATZ where the app can save a token', () => {
  const html = suggestions(() => {});
  expect(html).toContain('Position recommendations need STRATZ.');
  expect(html).toMatch(/<button[^>]*>Connect STRATZ<\/button>/);
});

it('keeps the plain hint where the app cannot connect', () => {
  const html = suggestions();
  expect(html).toContain('Connect STRATZ for position recommendations');
  expect(html).not.toContain('<button type="button" class="link-button stratz-prompt"');
});
