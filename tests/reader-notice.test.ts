import { describe, expect, it } from 'vitest';
import { showReaderNotice } from '../src/shared/reader-notice';
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
