// A stand-in for `window.ancient` in DOM tests. Import it before any component: the page
// reads `window.ancient` once, when `src/ui/App.tsx` loads.
import { vi, type Mock } from 'vitest';
import type { DesktopApi } from '../../src/shared/domain';

type Bridge = { [K in keyof DesktopApi]-?: Mock };

const methods = new Map<string, Mock>();
// Subscriptions (`onState`, `onLive`, …) hand back an unsubscribe function; every other
// method answers `undefined` until a test says otherwise.
const fallback = (name: string) => (name.startsWith('on') ? () => () => {} : async () => undefined);

/** Every bridge method is a mock; give one an answer with `mockResolvedValue` and friends. */
export const bridge = new Proxy({} as Bridge, {
  get(_, name: string) {
    if (!methods.has(name)) methods.set(name, vi.fn(fallback(name)));
    return methods.get(name);
  },
});
(window as unknown as { ancient: unknown }).ancient = bridge;

/** Forgets calls and answers between tests. */
export function resetBridge() {
  for (const [name, method] of methods) method.mockReset().mockImplementation(fallback(name));
}

/** A promise the test settles when it wants, to put answers in a chosen order. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
