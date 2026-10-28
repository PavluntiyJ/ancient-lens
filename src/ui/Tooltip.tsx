import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';

/** App-styled hover cards. Every `title` in the app shows as a plain card; data surfaces
 * pass rich content with `tip()`. One card is visible at a time. */

const SHOW_DELAY = 150;
/** An interactive card waits this long after the pointer leaves, so it can be reached. */
const HIDE_DELAY = 200;
const GAP = 8;
const MARGIN = 8;
const ARROW_INSET = 12;

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };
export type TipPlacement = { left: number; top: number; placement: 'below' | 'above'; arrow: number };

/** Below the anchor and centred on it; above when only that fits; always inside the window. */
export function placeTip(
  anchor: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): TipPlacement {
  const centre = (anchor.left + anchor.right) / 2;
  const left = Math.min(Math.max(MARGIN, centre - size.width / 2), viewport.width - MARGIN - size.width);
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - size.height;
  const placement = below + size.height > viewport.height - MARGIN && above >= MARGIN ? 'above' : 'below';
  return {
    left,
    top: placement === 'below' ? below : above,
    placement,
    arrow: Math.min(Math.max(ARROW_INSET, centre - left), size.width - ARROW_INSET),
  };
}

/** interactive: the pointer may move onto the card, which then stays open and takes clicks. */
type Active = { anchor: Element; content: ReactNode; interactive?: boolean };
let active: Active | undefined;
// Focus shows a card only after keyboard use, not when a dialog or click moves focus.
let keyboard = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: Element | undefined;
let closing: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const publish = (next: Active | undefined) => {
  clearTimeout(closing);
  active = next;
  listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
/** The visible card, if any (for tests). */
export const activeTip = () => active;
/** A field inside the open interactive card has focus: the user is writing in it. */
function writing() {
  const field = typeof document === 'undefined' ? null : document.activeElement;
  return !!active?.interactive && !!field && field.matches('input, textarea, select') && !!field.closest('.tooltip');
}
export function show(anchor: Element, content: ReactNode, interactive = false) {
  // Passing over other cells while writing a note must not replace the card.
  if (writing() && active?.anchor !== anchor) return;
  clearTimeout(timer);
  // New content for the visible card (a chart point) replaces it without the delay.
  if (active?.anchor === anchor) return publish({ anchor, content, interactive });
  pending = anchor;
  timer = setTimeout(() => {
    pending = undefined;
    publish({ anchor, content, interactive });
  }, SHOW_DELAY);
}
/** Hides the card of `anchor` (any card without one). Leaving one element must not cancel
 * the card another element is about to show: React enters the next element during the
 * native mouseout of the previous one. */
export function hide(anchor?: Element) {
  if (!anchor || pending === anchor) {
    clearTimeout(timer);
    pending = undefined;
  }
  if (!active || (anchor && active.anchor !== anchor) || (anchor && writing())) return;
  if (anchor && active.interactive) {
    clearTimeout(closing);
    closing = setTimeout(() => publish(undefined), HIDE_DELAY);
  } else publish(undefined);
}
/** The pointer reached an interactive card: keep it open. */
const hold = () => clearTimeout(closing);

/** Props that give an element a rich hover card; keep its aria-label for screen readers. */
export function tip(content: ReactNode, interactive = false) {
  const enter = (event: MouseEvent<Element> | FocusEvent<Element>) => {
    if (event.type === 'focus' && !keyboard) return;
    show(event.currentTarget, content, interactive);
  };
  const leave = (event: MouseEvent<Element> | FocusEvent<Element>) => hide(event.currentTarget);
  return { 'data-tip': '', onMouseEnter: enter, onMouseLeave: leave, onFocus: enter, onBlur: leave };
}

export function TipCard({
  icon,
  title,
  tag,
  value,
  rows,
  note,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  tag?: string;
  /** Plain value at the right end of the title line. */
  value?: ReactNode;
  rows?: [ReactNode, ReactNode][];
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="tip-card">
      <div className="tip-title">
        {icon}
        {title}
        {tag && <span className="tip-tag">{tag}</span>}
        {value !== undefined && <span className="tip-title-value">{value}</span>}
      </div>
      {children}
      {rows && rows.length > 0 && (
        <dl className="tip-rows">
          {rows.map(([label, value], index) => (
            <Fragment key={index}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      {note && <div className="tip-note">{note}</div>}
    </div>
  );
}

// Plain titles move to data-title while the app runs, so the system tooltip never shows.
const plainOf = (target: EventTarget | null) =>
  target instanceof Element ? target.closest('[title], [data-title]') : null;
function plainText(element: Element) {
  const title = element.getAttribute('title');
  if (title !== null) {
    element.setAttribute('data-title', title);
    element.removeAttribute('title');
  }
  return element.getAttribute('data-title') ?? '';
}

/** The single floating card. Rendered outside the zoomed shell; `scale` keeps its size in step. */
export function TooltipLayer({ scale }: { scale: number }) {
  const current = useSyncExternalStore(subscribe, () => active);
  const card = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<TipPlacement>();
  useEffect(() => {
    const enter = (event: Event) => {
      if (event.type === 'focusin' && !keyboard) return;
      // Titles inside an open interactive card do not replace it.
      if (event.target instanceof Node && card.current?.contains(event.target)) return;
      const plain = plainOf(event.target);
      const rich = event.target instanceof Element ? event.target.closest('[data-tip]') : null;
      // A rich card inside a titled container wins over the container's plain text.
      if (!plain || (rich && plain.contains(rich))) return;
      const text = plainText(plain);
      if (text.trim()) show(plain, <div className="tip-text">{text}</div>);
    };
    const leave = (event: Event) => {
      const plain = plainOf(event.target);
      const next = (event as globalThis.MouseEvent).relatedTarget;
      if (plain && !(next instanceof Node && plain.contains(next))) hide(plain);
    };
    const dismiss = (event: Event) => {
      keyboard = false;
      // A click inside an interactive card belongs to the card.
      if (event.target instanceof Node && card.current?.contains(event.target)) return;
      if (event.type === 'wheel' && writing()) return;
      hide();
    };
    const escape = (event: KeyboardEvent) => {
      keyboard = true;
      if (event.key === 'Escape') hide();
    };
    document.addEventListener('mouseover', enter);
    document.addEventListener('focusin', enter);
    document.addEventListener('mouseout', leave);
    document.addEventListener('focusout', leave);
    document.addEventListener('mousedown', dismiss, true);
    document.addEventListener('wheel', dismiss, { passive: true });
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mouseover', enter);
      document.removeEventListener('focusin', enter);
      document.removeEventListener('mouseout', leave);
      document.removeEventListener('focusout', leave);
      document.removeEventListener('mousedown', dismiss, true);
      document.removeEventListener('wheel', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  useLayoutEffect(() => {
    if (!current || !card.current) return setPlace(undefined);
    if (!current.anchor.isConnected) return hide();
    // The top layer keeps the card above a modal dialog such as the player card.
    try {
      if (!card.current.matches(':popover-open')) card.current.showPopover();
    } catch {
      /* Without popover support the fixed card still shows outside dialogs. */
    }
    const size = card.current.getBoundingClientRect();
    setPlace(placeTip(current.anchor.getBoundingClientRect(), size, { width: innerWidth, height: innerHeight }));
  }, [current]);
  if (!current) return null;
  // Fixed offsets are zoomed with the card, so they are given in unzoomed pixels.
  const style = {
    zoom: scale,
    left: (place?.left ?? 0) / scale,
    top: (place?.top ?? 0) / scale,
    visibility: place ? 'visible' : 'hidden',
    '--tip-arrow': `${(place?.arrow ?? 0) / scale}px`,
  } as CSSProperties;
  return (
    <div
      ref={card}
      className={`tooltip ${place?.placement ?? 'below'}${current.interactive ? ' interactive' : ''}`}
      role="tooltip"
      popover="manual"
      style={style}
      onMouseEnter={current.interactive ? hold : undefined}
      onMouseLeave={
        current.interactive
          ? (event) => {
              if (writing()) return;
              if (!(event.relatedTarget instanceof Node && current.anchor.contains(event.relatedTarget))) hide();
            }
          : undefined
      }
    >
      {current.content}
    </div>
  );
}
