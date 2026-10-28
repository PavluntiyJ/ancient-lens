import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

// Below this the text gets smaller than the title bar's; the page scrolls instead.
const MIN_FIT = 0.9;
// A large window enlarges the whole screen up to this, the roster first of all, instead of
// stretching the analysis panels ever taller.
const MAX_FIT = 1.3;
// Panel height (CSS px) the analysis panels keep before the screen grows past 100%.
const PANEL_PREFERRED = 400;

/**
 * The canvas zoom that fits the content into the host. `stretch` is how much of the content
 * the analysis panels add by filling spare space; it only counts while nothing overflows,
 * because overflowing panels are not stretched. `preferred` is what the panels would add to
 * reach their preferred height: past 100% the fit grows only while they keep it. `ceiling` is
 * the lowest zoom seen to overflow at this host size: the fit never goes back to it, so it
 * cannot oscillate.
 */
export function fitZoom({
  current,
  host,
  content,
  stretch,
  preferred = 0,
  widthLimit,
  ceiling,
}: {
  current: number;
  host: number;
  content: number;
  stretch: number;
  preferred?: number;
  widthLimit: number;
  ceiling: number;
}) {
  const overflow = content > host + 1;
  const needed = overflow ? content : content - stretch;
  const grow = overflow ? 0 : (current * (host - 1)) / (needed + preferred);
  const target = grow > 1 ? Math.min(MAX_FIT, grow) : Math.min(1, (current * (host - 1)) / needed);
  const fit = Math.min(target, widthLimit, ceiling - 0.002);
  return Math.max(MIN_FIT, Math.floor(fit * 1000) / 1000);
}

export function MatchViewport({ active, children }: { active: boolean; children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  useLayoutEffect(() => {
    const host = viewport.current,
      body = content.current;
    if (!active || !host || !body) return;
    let frame = 0;
    let ceiling = Infinity;
    let size = '';
    let last = { zoom: 0, height: 0 };
    // Fit only the match canvas; the title bar keeps the user's selected scale.
    const measure = () => {
      const available = host.getBoundingClientRect(),
        bounds = body.getBoundingClientRect();
      if (!available.height || !available.width || !bounds.height || !bounds.width) return;
      const current = Number(body.style.zoom) || 1;
      // A new window size, or content that got shorter at the same zoom (a notice or a
      // loading row gone), can fit more: forget zooms that overflowed before.
      if (
        `${available.width}x${available.height}` !== size ||
        (current === last.zoom && bounds.height < last.height - 2)
      ) {
        size = `${available.width}x${available.height}`;
        ceiling = Infinity;
      }
      last = { zoom: current, height: bounds.height };
      if (bounds.height > available.height + 1) ceiling = Math.min(ceiling, current);
      // Analysis panels stretch to fill the window; only their minimum height counts as
      // required content, otherwise a filled canvas never looks small enough to grow back.
      // The ratio of CSS heights is independent of the app scale and this zoom.
      const panel = body.querySelector<HTMLElement>('.analysis-panel');
      const style = panel && getComputedStyle(panel);
      const stretch =
        panel && style
          ? panel.getBoundingClientRect().height *
            Math.max(0, 1 - parseFloat(style.minHeight) / (parseFloat(style.height) || Infinity))
          : 0;
      // The same panel in screen px per CSS px, for the room up to the preferred height.
      const preferred =
        panel && style
          ? (panel.getBoundingClientRect().height / (parseFloat(style.height) || Infinity)) *
            Math.max(0, PANEL_PREFERRED - parseFloat(style.minHeight))
          : 0;
      // The canvas fills the host at any zoom, so its measured width says nothing; only
      // its CSS min-width (unzoomed px) limits the fit. Comparing zoomed widths oscillated.
      const minWidth = parseFloat(getComputedStyle(body).minWidth) || 0;
      const widthLimit = minWidth ? host.clientWidth / minWidth : 1;
      const next = fitZoom({
        current,
        host: available.height,
        content: bounds.height,
        stretch,
        preferred,
        widthLimit,
        ceiling,
      });
      setFit((previous) => (Math.abs(previous - next) >= 0.002 ? next : previous));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(host);
    observer.observe(body);
    schedule();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [active]);
  return (
    <div className={fit <= MIN_FIT ? 'match-page match-scroll' : 'match-page'} ref={viewport} hidden={!active}>
      {/* --zoom: the total zoom, for CSS that converts container units back to CSS px. */}
      <div
        className="match-fit"
        ref={content}
        style={{ zoom: fit, '--zoom': `calc(var(--ui-scale, 1) * ${fit})` } as CSSProperties}
      >
        {children}
      </div>
    </div>
  );
}
