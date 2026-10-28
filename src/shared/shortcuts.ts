// Rebindable keys. The same names and canonical form are used by the Rust store and the
// settings page, so a stored combination is always in `Ctrl+Alt+Shift+Code` order.
export type ShortcutName =
  'global' | 'leftPrevious' | 'leftNext' | 'rightPrevious' | 'rightNext' | 'lanePrevious' | 'laneNext';
export type Shortcuts = Record<ShortcutName, string>;

export const shortcutNames: { name: ShortcutName; label: string; detail: string; global?: boolean }[] = [
  {
    name: 'global',
    label: 'Show or hide the window',
    detail: 'Works while Dota 2 has the keyboard. On Linux the desktop assigns this key.',
    global: true,
  },
  { name: 'leftPrevious', label: 'Left panel: previous page', detail: 'Alt + ← today.' },
  { name: 'leftNext', label: 'Left panel: next page', detail: 'Alt + → today.' },
  { name: 'rightPrevious', label: 'Right panel: previous page', detail: 'Shift + ← today.' },
  { name: 'rightNext', label: 'Right panel: next page', detail: 'Shift + → today.' },
  { name: 'lanePrevious', label: 'Previous recommendation lane', detail: 'Alt + ↑ today.' },
  { name: 'laneNext', label: 'Next recommendation lane', detail: 'Alt + ↓ today.' },
];

export const defaultShortcuts: Shortcuts = {
  global: 'Alt+Numpad5',
  leftPrevious: 'Alt+ArrowLeft',
  leftNext: 'Alt+ArrowRight',
  rightPrevious: 'Shift+ArrowLeft',
  rightNext: 'Shift+ArrowRight',
  lanePrevious: 'Alt+ArrowUp',
  laneNext: 'Alt+ArrowDown',
};

/** Combinations the window or the operating system keeps for itself. */
export const reservedCombinations: { combo: string; reason: string }[] = [
  { combo: 'Ctrl+KeyW', reason: 'closes the window' },
  { combo: 'Ctrl+KeyR', reason: 'reloads the page' },
  { combo: 'Ctrl+Shift+KeyI', reason: 'opens developer tools' },
  { combo: 'Ctrl+Shift+KeyJ', reason: 'opens developer tools' },
  { combo: 'Ctrl+Shift+KeyC', reason: 'opens developer tools' },
  { combo: 'Alt+F4', reason: 'closes the window' },
  { combo: 'Alt+Tab', reason: 'switches applications' },
  { combo: 'Ctrl+Alt+Delete', reason: 'is reserved by Windows' },
];

const modifier = (token: string) => {
  switch (token.toLowerCase()) {
    case 'ctrl':
    case 'control':
      return 'Ctrl';
    case 'alt':
    case 'option':
      return 'Alt';
    case 'shift':
      return 'Shift';
    default:
      return undefined;
  }
};

/** A keyboard event's physical code as a shortcut key, or null for modifiers/dead keys. */
export function shortcutKey(code: string): string | null {
  if (
    /^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2])|Arrow(Left|Right|Up|Down)|Numpad[0-9]|Tab|Enter|Space|Delete|Insert|Home|End|PageUp|PageDown)$/.test(
      code,
    )
  )
    return code;
  return null;
}

const keyAlias = (token: string) => {
  if (
    /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(Left|Right|Up|Down)|F([1-9]|1[0-2])|Tab|Enter|Space|Delete|Insert|Home|End|PageUp|PageDown)$/.test(
      token,
    )
  ) {
    return token;
  }
  const upper = token.toUpperCase();
  if (upper.length === 1 && /[A-Z]/.test(upper)) return `Key${upper}`;
  if (upper.length === 1 && /[0-9]/.test(upper)) return `Digit${upper}`;
  const numpad = upper.match(/^(?:NUM|NUMPAD)([0-9])$/);
  if (numpad) return `Numpad${numpad[1]}`;
  for (const name of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
    if (upper === name.toUpperCase() || upper === name.replace('Arrow', '').toUpperCase()) return name;
  }
  if (/^F([1-9]|1[0-2])$/.test(upper)) return upper;
  for (const name of ['Tab', 'Enter', 'Space', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown']) {
    if (upper === name.toUpperCase()) return name;
  }
  return null;
};

/** Canonical form, or null when the text is not a supported combination. */
export function normalizeShortcut(raw: string): string | null {
  const tokens = raw
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean);
  const key = keyAlias(tokens.pop() ?? '');
  if (!key) return null;
  const found = { Ctrl: false, Alt: false, Shift: false };
  for (const token of tokens) {
    const name = modifier(token);
    if (!name || found[name]) return null;
    found[name] = true;
  }
  const parts = (['Ctrl', 'Alt', 'Shift'] as const).filter((name) => found[name]);
  if (!parts.length) return null;
  return [...parts, key].join('+');
}

/** The combination of a real key press; modifier-only presses and Escape return null. */
export function shortcutFromEvent(event: KeyboardEvent): string | null {
  const key = shortcutKey(event.code);
  if (!key || event.metaKey) return null;
  const parts = [
    ...(event.ctrlKey ? ['Ctrl'] : []),
    ...(event.altKey ? ['Alt'] : []),
    ...(event.shiftKey ? ['Shift'] : []),
  ];
  if (!parts.length) return null;
  return [...parts, key].join('+');
}

export function matchesShortcut(
  event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
  combo: string,
): boolean {
  const normalized = normalizeShortcut(combo);
  if (!normalized || normalized !== shortcutFromEvent(event as KeyboardEvent)) return false;
  return true;
}

/** The first reason a binding cannot be used, or null when it is free. */
export function shortcutProblem(shortcuts: Shortcuts, name: ShortcutName, combo: string): string | null {
  const normalized = normalizeShortcut(combo);
  if (!normalized) return 'Use Ctrl, Alt or Shift with a letter, digit, arrow or F1–F12.';
  const reserved = reservedCombinations.find((entry) => entry.combo === normalized);
  if (reserved) return `This key ${reserved.reason}.`;
  const duplicate = (Object.keys(shortcuts) as ShortcutName[]).find(
    (other) => other !== name && normalizeShortcut(shortcuts[other]) === normalized,
  );
  if (duplicate) {
    const label = shortcutNames.find((entry) => entry.name === duplicate)?.label ?? duplicate;
    return `Already used for “${label}”.`;
  }
  return null;
}

/** Every binding that conflicts, so the form can mark all rows at once. */
export function shortcutConflicts(shortcuts: Shortcuts): Partial<Record<ShortcutName, string>> {
  const problems: Partial<Record<ShortcutName, string>> = {};
  for (const { name } of shortcutNames) {
    const problem = shortcutProblem(shortcuts, name, shortcuts[name]);
    if (problem) problems[name] = problem;
  }
  return problems;
}
