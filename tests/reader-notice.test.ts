import { describe, expect, it } from 'vitest';
import { shouldAskReader, showReaderNotice } from '../src/shared/reader-notice';
import type { LiveState } from '../src/shared/domain';

const live: LiveState = { status: 'connected', receivedAt: 1, mode: 'player', rosterStatus: 'disabled' };
describe('reader notice', () => {
  it('explains disabled reading only to connected players on Linux and Windows', () => {
    expect(showReaderNotice('linux', live, true)).toBe(true);
    expect(showReaderNotice('win32', live, true)).toBe(true);
    expect(showReaderNotice('darwin', live, true)).toBe(false);
    expect(showReaderNotice(undefined, live, true)).toBe(false);
    expect(showReaderNotice('linux', live, false)).toBe(false);
    expect(showReaderNotice('linux', { ...live, mode: 'spectator' }, true)).toBe(false);
    expect(showReaderNotice('linux', { ...live, rosterStatus: 'ready' }, true)).toBe(false);
  });
});

describe('first-run reader question', () => {
  const windows = { platform: 'win32', readerPrompt: true };
  it('asks once where a reader exists and while it is off', () => {
    expect(shouldAskReader(windows, 'off', false)).toBe(true);
    expect(shouldAskReader(windows, undefined, false)).toBe(true);
    expect(shouldAskReader({ platform: 'linux' }, 'off', false)).toBe(true);
  });
  it('stays quiet once answered, when reading is on, on other systems and in isolated test runs', () => {
    expect(shouldAskReader(windows, 'off', true)).toBe(false);
    expect(shouldAskReader(windows, 'on', false)).toBe(false);
    expect(shouldAskReader({ platform: 'darwin', readerPrompt: true }, 'off', false)).toBe(false);
    expect(shouldAskReader({ ...windows, readerPrompt: false }, 'off', false)).toBe(false);
    expect(shouldAskReader(undefined, 'off', false)).toBe(false);
  });
});
