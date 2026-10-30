import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PartyBracket } from '../src/ui/PartyBracket';

it('draws nothing without a party', () => {
  expect(renderToStaticMarkup(<PartyBracket pieces={[]} />)).toBe('');
});

it('draws a dashed member piece with its evidence and a plain connector', () => {
  const html = renderToStaticMarkup(
    <PartyBracket
      pieces={[
        { colour: 2, sure: false, member: true, top: true, bottom: false, lane: 0 },
        { colour: 1, sure: true, member: false, top: false, bottom: false, lane: 1 },
      ]}
      tip="Likely party with Moss: on the same team in 3 recent matches."
    />,
  );
  expect(html).toContain('class="party-bracket member top likely"');
  expect(html).toContain('style="--party:var(--party-2)"');
  expect(html).toContain('title="Likely party with Moss: on the same team in 3 recent matches."');
  expect(html).toContain('class="party-bracket through lane-1"');
  // Only member pieces carry the evidence.
  expect(html.match(/title=/g)).toHaveLength(1);
});
