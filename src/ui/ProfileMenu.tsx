import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import { useDisplaySettings } from './preferences';

/** A viewport-contained menu outside the page flow and its scrolling containers. */
export function ProfileMenu({
  label,
  icon,
  caret = false,
  children,
}: {
  label: string;
  icon?: ReactNode;
  /** A down caret after the label, for a menu that reads as a dropdown. */
  caret?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; top: number }>();
  const scale = useDisplaySettings().scale / 100;
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      if (panel.current) {
        panel.current.style.maxWidth = `${(innerWidth - 16) / scale}px`;
        panel.current.style.maxHeight = `${(innerHeight - 16) / scale}px`;
      }
      const anchor = trigger.current?.getBoundingClientRect(),
        menu = panel.current?.getBoundingClientRect();
      if (!anchor || !menu) return;
      setPlace({
        left: Math.max(8, Math.min(anchor.left, innerWidth - menu.width - 8)) / scale,
        top: Math.max(8, Math.min(anchor.bottom + 6, innerHeight - menu.height - 8)) / scale,
      });
    };
    position();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    const observer = new ResizeObserver(position);
    if (panel.current) observer.observe(panel.current);
    panel.current?.querySelector<HTMLElement>('button')?.focus();
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position, true);
      observer.disconnect();
    };
  }, [open, scale]);
  return (
    <>
      <button
        className="secondary profile-menu-trigger"
        ref={trigger}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          setPlace(undefined);
          setOpen(!open);
        }}
      >
        {icon}
        {label}
        {caret && <ChevronDown size={13} aria-hidden="true" />}
      </button>
      {open &&
        createPortal(
          <div
            className="profile-menu"
            id={id}
            ref={panel}
            role="region"
            aria-label={label}
            style={{
              zoom: scale,
              left: place?.left ?? 0,
              top: place?.top ?? 0,
              visibility: place ? 'visible' : 'hidden',
            }}
          >
            <header>
              <strong>{label}</strong>
              <button
                className="icon-button"
                aria-label={`Close ${label.toLowerCase()}`}
                onClick={() => {
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                <X size={16} />
              </button>
            </header>
            <div className="profile-menu-fields">{children}</div>
          </div>,
          document.body,
        )}
    </>
  );
}
