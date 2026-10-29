import { useEffect, useState, type ReactNode } from 'react';
import { Keyboard, Minus, Square, X } from 'lucide-react';
import type { AppInfo, WindowEdge, WindowName } from '../shared/domain';
import { matchesShortcut, type Shortcuts } from '../shared/shortcuts';
import { api, errorMessage } from './App';

// Shared by the match and the profile window: title bar, window buttons, resize edges, and
// how a window that stays above the game gets the keyboard.

export function TitleBar({
  title,
  brand,
  children,
  info,
  onError,
}: {
  title: string;
  brand: ReactNode;
  children?: ReactNode;
  info?: AppInfo;
  onError(message: string): void;
}) {
  async function windowAction(action: 'drag' | 'minimize' | 'maximize' | 'close') {
    try {
      await api.windowAction?.(action);
    } catch (e) {
      onError(errorMessage(e));
    }
  }
  return (
    <header className="app-toolbar slim-toolbar">
      <div
        className="titlebar-drag"
        title={title}
        onMouseDown={(event) => {
          if (event.button === 0 && event.detail === 1) void windowAction('drag');
        }}
        onDoubleClick={() => void windowAction('maximize')}
      >
        <div className="compact-brand">{brand}</div>
      </div>
      {children}
      {info?.overlay && <KeyboardButton />}
      {api.windowAction && (
        <div className="window-controls">
          <button aria-label="Minimize window" title="Minimize" onClick={() => void windowAction('minimize')}>
            <Minus size={15} />
          </button>
          <button
            aria-label="Maximize or restore window"
            title="Maximize / restore"
            onClick={() => void windowAction('maximize')}
          >
            <Square size={13} />
          </button>
          <button
            className="window-close"
            aria-label="Close window"
            title="Hide this window"
            onClick={() => void windowAction('close')}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </header>
  );
}

const edges: WindowEdge[] = ['North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest'];
export function ResizeEdges({ onError }: { onError(message: string): void }) {
  if (!api.resizeWindow) return null;
  return edges.map((edge) => (
    <div
      key={edge}
      className={`window-resize-edge edge-${edge.toLowerCase()}`}
      aria-hidden="true"
      onMouseDown={(event) => {
        if (event.button === 0) void api.resizeWindow!(edge).catch((e) => onError(errorMessage(e)));
      }}
    />
  ));
}

/** Whether this window has the keyboard. */
function useWindowFocus() {
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const focus = () => setFocused(true);
    const blur = () => setFocused(false);
    window.addEventListener('focus', focus);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('focus', focus);
      window.removeEventListener('blur', blur);
    };
  }, []);
  return focused;
}

function KeyboardButton() {
  const focused = useWindowFocus();
  return (
    <button
      type="button"
      className={`keyboard-button ${focused ? 'active' : ''}`}
      aria-label="Type in this window"
      aria-pressed={focused}
      title={
        focused
          ? 'This window has the keyboard. Click the game to give it back.'
          : 'Give this window the keyboard, for the panel keys. The game goes to the background.'
      }
      onClick={() => void api.setKeyboard?.(true).catch(() => {})}
    >
      <Keyboard size={15} />
    </button>
  );
}

/** Elements that need typing: clicking one gives the window the keyboard. */
export const typingTarget =
  'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]):not([type=reset]):not([type=color]):not([type=file]), textarea, [contenteditable]:not([contenteditable=false]), [data-needs-keyboard]';

/**
 * A window above the game does not take the keyboard when clicked, so the game keeps its
 * focus and sound. A click on a text field, or on a button that records keys, asks for the
 * keyboard; the window gives it back when it loses the focus.
 */
export function useKeyboardOnDemand(info?: AppInfo) {
  const overlay = !!info?.overlay;
  useEffect(() => {
    if (!overlay || !api.setKeyboard) return;
    const down = (event: PointerEvent) => {
      if (document.hasFocus() || !(event.target instanceof Element)) return;
      const target = event.target.closest<HTMLElement>(typingTarget);
      if (!target) return;
      void api.setKeyboard!(true).then(
        () => {
          if (target.matches('input, textarea, [contenteditable]')) target.focus();
        },
        () => {},
      );
    };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [overlay]);
}

/**
 * A desktop that only offers an X11 key grab misses the global keys while one of these
 * windows has the keyboard; handle them here so the next press still hides a window.
 * Windows registers the keys globally and would otherwise toggle twice.
 */
export function useFallbackShortcuts(info: AppInfo | undefined, shortcuts: Shortcuts) {
  const fallback = info?.platform === 'linux' && !info?.shortcutTrigger;
  const { global, profile } = shortcuts;
  useEffect(() => {
    if (!fallback) return;
    const keys: [string, WindowName][] = [
      [global, 'main'],
      [profile, 'profile'],
    ];
    const toggle = (event: KeyboardEvent) => {
      const found = keys.find(([combo]) => matchesShortcut(event, combo));
      if (!found) return;
      event.preventDefault();
      if (!event.repeat) void api?.toggleWindow(found[1]).catch(() => {});
    };
    window.addEventListener('keydown', toggle);
    return () => window.removeEventListener('keydown', toggle);
  }, [fallback, global, profile]);
}
