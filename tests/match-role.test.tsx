import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { vi } from 'vitest';
import { MatchRole } from '../src/ui/Roles';

vi.mock('../src/ui/MatchScreen', () => ({ Portrait: () => <span className="portrait" /> }));

it('marks a guessed role as likely and explains it', () => {
  const html = renderToStaticMarkup(
    <MatchRole
      role={{ position: 5, guessed: true, player: { games: 20, known: 22 }, hero: { share: 0.9 } }}
      heroName="Witch Doctor"
    />,
  );
  expect(html).toContain('class="match-role guessed"');
  expect(html).toContain('hardsupport');
  expect(html).toContain('?');
  expect(html).toContain(
    'Likely Hard Support · 20 of 22 matches with a known position · Witch Doctor: 90% of matches in this position',
  );
});
it('shows a lane chosen in the draft as known, and a dash without data', () => {
  const known = renderToStaticMarkup(<MatchRole role={{ position: 1, guessed: false }} />);
  expect(known).toContain('class="match-role"');
  expect(known).toContain('Safe Lane · selected in the draft');
  expect(known).not.toContain('Likely');
  const none = renderToStaticMarkup(<MatchRole />);
  expect(none).toContain('match-role unknown');
  expect(none).toContain('—');
  // A private profile explains the guess by the hero alone.
  const hero = renderToStaticMarkup(
    <MatchRole role={{ position: 3, guessed: true, hero: { share: 0.5 } }} heroName="Mars" />,
  );
  expect(hero).toContain('Likely Off Lane · private or no matches · Mars: 50% of matches in this position');
});
