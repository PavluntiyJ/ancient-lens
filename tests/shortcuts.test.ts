import { describe, expect, it } from 'vitest';
import {
  defaultShortcuts,
  matchesShortcut,
  normalizeShortcut,
  shortcutConflicts,
  shortcutFromEvent,
  shortcutNames,
  shortcutProblem,
} from '../src/shared/shortcuts';

const key = (code: string, modifiers: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) =>
  ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers }) as KeyboardEvent;

describe('shortcut normalization', () => {
  it('keeps every default in canonical form', () => {
    for (const combo of Object.values(defaultShortcuts)) expect(normalizeShortcut(combo)).toBe(combo);
  });
  it('accepts friendly aliases and puts modifiers in one order', () => {
    expect(normalizeShortcut('shift+ctrl+a')).toBe('Ctrl+Shift+KeyA');
    expect(normalizeShortcut('ALT+LEFT')).toBe('Alt+ArrowLeft');
    expect(normalizeShortcut('Alt+Num5')).toBe('Alt+Numpad5');
    expect(normalizeShortcut('Ctrl+1')).toBe('Ctrl+Digit1');
    expect(normalizeShortcut('Ctrl+F12')).toBe('Ctrl+F12');
  });
  it('rejects combinations the recorder cannot produce', () => {
    expect(normalizeShortcut('A')).toBeNull();
    expect(normalizeShortcut('Escape')).toBeNull();
    expect(normalizeShortcut('Super+A')).toBeNull();
    expect(normalizeShortcut('Ctrl+Ctrl+A')).toBeNull();
    expect(normalizeShortcut('Ctrl+F13')).toBeNull();
    expect(normalizeShortcut('Ctrl+Backspace')).toBeNull();
    expect(normalizeShortcut('Ctrl+Delete')).toBe('Ctrl+Delete');
  });
});

describe('shortcut recorder', () => {
  it('reads the physical code, so Num Lock does not change the key', () => {
    expect(shortcutFromEvent(key('Numpad5', { altKey: true }))).toBe('Alt+Numpad5');
    expect(shortcutFromEvent(key('Numpad5', { altKey: true, shiftKey: true }))).toBe('Alt+Shift+Numpad5');
  });
  it('ignores modifier-only presses, Escape and combinations with Meta', () => {
    expect(shortcutFromEvent(key('AltLeft', { altKey: true }))).toBeNull();
    expect(shortcutFromEvent(key('Escape'))).toBeNull();
    expect(shortcutFromEvent(key('KeyA', { ctrlKey: true, metaKey: true }))).toBeNull();
    expect(shortcutFromEvent(key('KeyA'))).toBeNull();
  });
  it('matches exactly the stored modifiers and key', () => {
    expect(matchesShortcut(key('ArrowLeft', { altKey: true }), 'Alt+ArrowLeft')).toBe(true);
    expect(matchesShortcut(key('ArrowLeft', { altKey: true, shiftKey: true }), 'Alt+ArrowLeft')).toBe(false);
    expect(matchesShortcut(key('KeyA', { altKey: true }), 'Alt+ArrowLeft')).toBe(false);
  });
});

describe('conflicts', () => {
  it('reports duplicate bindings with the other action', () => {
    const shortcuts = { ...defaultShortcuts, leftNext: 'Alt+ArrowLeft' };
    expect(shortcutProblem(shortcuts, 'leftNext', 'Alt+ArrowLeft')).toContain('Left panel: previous page');
    expect(shortcutConflicts(shortcuts).leftNext).toBeTruthy();
  });
  it('keeps window and system combinations free', () => {
    expect(shortcutProblem(defaultShortcuts, 'global', 'Ctrl+KeyW')).toContain('closes the window');
    expect(shortcutProblem(defaultShortcuts, 'global', 'Alt+Tab')).toContain('switches applications');
  });
  it('accepts an unused combination', () => {
    expect(shortcutProblem(defaultShortcuts, 'leftNext', 'Ctrl+Alt+F9')).toBeNull();
  });
});

describe('profile window key', () => {
  it('is a second global key with its own default', () => {
    expect(shortcutNames.filter((entry) => entry.global).map((entry) => entry.name)).toEqual(['global', 'profile']);
    expect(defaultShortcuts.profile).toBe('Alt+Numpad6');
    expect(shortcutConflicts(defaultShortcuts)).toEqual({});
  });
  it('cannot share a combination with the match window or a panel key', () => {
    expect(shortcutProblem(defaultShortcuts, 'profile', 'Alt+Numpad5')).toContain('Show or hide the match window');
    expect(shortcutProblem(defaultShortcuts, 'global', 'Alt+Numpad6')).toContain('Show or hide the profile window');
    expect(shortcutProblem(defaultShortcuts, 'profile', 'Alt+ArrowLeft')).toContain('Left panel: previous page');
    expect(shortcutProblem(defaultShortcuts, 'profile', 'Alt+F4')).toContain('closes the window');
  });
});
