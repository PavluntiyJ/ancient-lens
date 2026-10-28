import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Keycaps } from '../src/ui/Keycaps';

it('shows the shortcut as keycaps with readable numpad names', () => {
  expect(renderToStaticMarkup(<Keycaps combo="Alt+Numpad5" />)).toBe(
    '<span class="keycaps" aria-label="Alt + Num 5"><kbd>Alt</kbd><span aria-hidden="true">+</span><kbd>Num 5</kbd></span>',
  );
  expect(renderToStaticMarkup(<Keycaps combo="Ctrl + Shift + KP_Begin" />)).toContain(
    'aria-label="Ctrl + Shift + Num 5"',
  );
  expect(renderToStaticMarkup(<Keycaps combo="Meta+F9" />)).toContain('<kbd>Meta</kbd>');
});
