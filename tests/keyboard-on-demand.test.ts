import { afterEach, expect, it, vi } from 'vitest';

const setKeyboard = vi.fn(() => Promise.resolve());
vi.mock('../src/ui/App', () => ({ api: { setKeyboard }, errorMessage: String }));
// The hook only registers a listener; run its effect at once instead of rendering a window.
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useEffect: (effect: () => void) => effect(),
}));

class FakeElement {
  constructor(private readonly typing: boolean) {}
  closest() {
    return this.typing ? this : null;
  }
  matches() {
    return false;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  setKeyboard.mockClear();
});

it('asks for the keyboard above the game even when the page reports the focus', async () => {
  // WebView2 reports the focus after a click into the passive window while the game keeps
  // the keys; the note editor then showed a cursor and the typing reached the game.
  const listeners: ((event: { target: unknown }) => void)[] = [];
  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('document', { hasFocus: () => true });
  vi.stubGlobal('window', { addEventListener: (_: string, listener: never) => listeners.push(listener) });
  const { useKeyboardOnDemand } = await import('../src/ui/WindowFrame');
  useKeyboardOnDemand({ overlay: true } as never);
  expect(listeners).toHaveLength(1);
  listeners[0]({ target: new FakeElement(false) });
  expect(setKeyboard).not.toHaveBeenCalled();
  listeners[0]({ target: new FakeElement(true) });
  expect(setKeyboard).toHaveBeenCalledWith(true);
});
