import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ColumnTip, InfoHeader, rosterColumns } from '../src/ui/ColumnInfo';

it('explains a column with its formula, source and colours', () => {
  const html = renderToStaticMarkup(<ColumnTip info={rosterColumns.role} />);
  expect(html).toContain('This match&#x27;s role');
  expect(html).toContain('Source: the draft (game)');
});

it('makes the label and icon one keyboard target without a native title', () => {
  const html = renderToStaticMarkup(<InfoHeader label="Games · WR" info={rosterColumns.periodGames(30)} />);
  expect(html).toMatch(
    /^<span class="column-info" tabindex="0" aria-label="Games and win rate, last 30 days" data-tip="">Games · WR<svg/,
  );
  expect(html).not.toContain('title=');
});

it('states a source for every column', () => {
  const infos = [...Object.values(rosterColumns).map((info) => (typeof info === 'function' ? info(30, 5) : info))];
  for (const info of infos) expect(info.source.length).toBeGreaterThan(5);
});
