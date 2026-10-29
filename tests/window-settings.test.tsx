import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ShortcutSettings } from '../src/ui/settings/ShortcutSettings';
import { WindowSettings } from '../src/ui/settings/WindowSettings';
import { typingTarget } from '../src/ui/WindowFrame';
import type { AppInfo, LocalState } from '../src/shared/domain';

vi.mock('../src/ui/App', () => ({ api: { setCloseToTray: () => Promise.resolve() }, errorMessage: String }));

const local: LocalState = {
  accountId: '',
  notes: [],
  mmr: [],
  shortcuts: {
    global: 'Alt+Numpad5',
    profile: 'Ctrl+Alt+KeyP',
    leftPrevious: 'Alt+ArrowLeft',
    leftNext: 'Alt+ArrowRight',
    rightPrevious: 'Shift+ArrowLeft',
    rightNext: 'Shift+ArrowRight',
    lanePrevious: 'Alt+ArrowUp',
    laneNext: 'Alt+ArrowDown',
  },
};
const info = (extra: Partial<AppInfo>): AppInfo => ({
  version: '0.5.0',
  platform: 'win32',
  wayland: false,
  shortcut: true,
  profileShortcut: true,
  dataPath: '',
  gsiPort: 1,
  ...extra,
});
const rows = (html: string) =>
  [...html.matchAll(/<div class="shortcut-row"><div><b>([^<]+)<\/b>.*?aria-label="([^"]+)"/g)].map((m) => [m[1], m[2]]);

describe('shortcut settings', () => {
  it('lists a rebindable key for each window', () => {
    const html = renderToStaticMarkup(
      <ShortcutSettings local={local} update={() => {}} info={{ platform: 'win32' }} />,
    );
    expect(rows(html).slice(0, 2)).toEqual([
      ['Show or hide the match window', 'Alt + Num 5'],
      ['Show or hide the profile window', 'Ctrl + Alt + P'],
    ]);
    expect(html).toContain('aria-label="Change Show or hide the profile window"');
    // Recording a key needs the keyboard, which a window over the game does not have yet.
    expect(html).toMatch(/data-needs-keyboard="true" aria-label="Change Show or hide the profile window"/);
  });

  it('shows the keys the Linux desktop assigned, without a Change button', () => {
    const html = renderToStaticMarkup(
      <ShortcutSettings
        local={local}
        update={() => {}}
        info={{ platform: 'linux', shortcutTrigger: 'Alt+KP_Begin', profileShortcutTrigger: 'Ctrl+Shift+F8' }}
      />,
    );
    expect(rows(html).slice(0, 2)).toEqual([
      ['Show or hide the match window', 'Alt + Num 5'],
      ['Show or hide the profile window', 'Ctrl + Shift + F8'],
    ]);
    expect(html).not.toContain('Change Show or hide the profile window');
    expect(html).toContain('Change Left panel: previous page');
  });
});

describe('window settings', () => {
  it('names both keys and says the game keeps the keyboard', () => {
    const html = renderToStaticMarkup(
      <WindowSettings local={local} update={() => {}} info={info({ overlay: true, tray: true })} />,
    );
    expect(html).toContain('aria-label="Alt + Num 5"');
    expect(html).toContain('shows or hides the match window');
    expect(html).toContain('aria-label="Ctrl + Alt + P"');
    expect(html).toContain('shows or hides the profile window');
    expect(html).toContain('leaves the keyboard with the game');
  });

  it('reports a key another application owns, and the Wayland limits', () => {
    const html = renderToStaticMarkup(
      <WindowSettings
        local={local}
        update={() => {}}
        info={info({ platform: 'linux', wayland: true, overlay: false, profileShortcut: false })}
      />,
    );
    expect(html).toContain('profile window&#x27;s key is unavailable');
    expect(html).toContain('On Wayland the desktop decides');
    expect(html).not.toContain('leaves the keyboard with the game');
  });
});

describe('keyboard on demand', () => {
  it('asks for the keyboard on text fields, not on buttons, boxes or sliders', () => {
    for (const selector of ['input:not([type=checkbox])', 'textarea', '[data-needs-keyboard]', '[contenteditable]'])
      expect(typingTarget).toContain(selector);
    for (const type of ['checkbox', 'radio', 'range', 'button']) expect(typingTarget).toContain(`[type=${type}]`);
  });
});
