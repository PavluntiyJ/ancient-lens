import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { activeTip, hide, placeTip, show, TipCard } from '../src/ui/Tooltip';

const viewport = { width: 1000, height: 800 };
const anchor = (left: number, top: number, width = 40, height = 20) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});

describe('tooltip placement', () => {
  it('opens below the anchor, centred, with the arrow on its middle', () => {
    expect(placeTip(anchor(480, 100), { width: 200, height: 80 }, viewport)).toEqual({
      left: 400,
      top: 128,
      placement: 'below',
      arrow: 100,
    });
  });
  it('flips above when the space below is too small', () => {
    const place = placeTip(anchor(480, 740), { width: 200, height: 80 }, viewport);
    expect(place.placement).toBe('above');
    expect(place.top).toBe(740 - 8 - 80);
  });
  it('stays inside the window and keeps the arrow pointing at the anchor', () => {
    const left = placeTip(anchor(0, 100, 20), { width: 200, height: 80 }, viewport);
    expect(left.left).toBe(8);
    expect(left.arrow).toBe(12);
    const right = placeTip(anchor(975, 100, 20), { width: 200, height: 80 }, viewport);
    expect(right.left).toBe(1000 - 8 - 200);
    expect(right.arrow).toBe(200 - 12);
  });
  it('opens beside a row: right of it, top-aligned, or left when the right has no room', () => {
    const row = anchor(20, 300, 300, 50);
    expect(placeTip(row, { width: 400, height: 300 }, viewport, true)).toEqual({
      left: 328,
      top: 300,
      placement: 'right',
      arrow: 25,
    });
    const wide = placeTip(anchor(500, 600, 300, 50), { width: 400, height: 300 }, viewport, true);
    expect(wide.placement).toBe('left');
    expect(wide.left).toBe(500 - 8 - 400);
    // Kept inside the window: moved up, the arrow still at the row's middle.
    expect(wide.top).toBe(800 - 8 - 300);
    expect(wide.arrow).toBe(625 - 492);
  });
});

it('lays a card out as title, labelled rows and a note', () => {
  const html = renderToStaticMarkup(
    <TipCard
      title="Hard Support"
      tag="Likely"
      rows={[
        ['Player, last 14 days', '59 of 59 games'],
        ['Lich in this role', <b key="share">69%</b>],
      ]}
      note="Guessed for the whole team"
    />,
  );
  expect(html).toMatch(/class="tip-title">Hard Support<span class="tip-tag">Likely<\/span>/);
  expect(html.match(/<dt>/g)).toHaveLength(2);
  expect(html).toContain('<dd>59 of 59 games</dd>');
  expect(html).toContain('class="tip-note">Guessed for the whole team');
});

describe('one card at a time', () => {
  it('opens a card when the pointer leaves a titled element for a rich one in the same move', () => {
    vi.useFakeTimers();
    const titled = {} as Element;
    const rich = {} as Element;
    // React fires mouseenter on the rich cell during the native mouseout of the titled
    // one; the document's plain-title handler then hides the titled element.
    show(rich, 'card');
    hide(titled);
    vi.advanceTimersByTime(200);
    expect(activeTip()?.anchor).toBe(rich);
    hide(rich);
    expect(activeTip()).toBeUndefined();
    show(rich, 'card');
    hide(rich);
    vi.advanceTimersByTime(200);
    expect(activeTip()).toBeUndefined();
    vi.useRealTimers();
  });
  it('keeps an interactive card open long enough for the pointer to reach it', () => {
    vi.useFakeTimers();
    const name = {} as Element;
    show(name, 'preview', true);
    vi.advanceTimersByTime(200);
    // Leaving the name starts a short wait instead of closing at once.
    hide(name);
    vi.advanceTimersByTime(100);
    expect(activeTip()?.interactive).toBe(true);
    // Back on the name (or on the card) the card stays.
    show(name, 'preview', true);
    vi.advanceTimersByTime(500);
    expect(activeTip()?.anchor).toBe(name);
    hide(name);
    vi.advanceTimersByTime(250);
    expect(activeTip()).toBeUndefined();
    vi.useRealTimers();
  });
});
