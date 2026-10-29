import { describe, expect, it } from 'vitest';
import type { ProviderInfo } from '../src/shared/domain';
import { shouldAskStratz } from '../src/shared/stratz-notice';

const provider: ProviderInfo = {
  source: 'OpenDota',
  hasToken: false,
  persistent: false,
  automatic: true,
  connectable: true,
  serviceConfigured: false,
};

describe('first-run STRATZ offer', () => {
  it('offers the unconfigured provider on both supported systems independently of reading', () => {
    for (const platform of ['linux', 'win32']) {
      expect(shouldAskStratz({ platform }, provider, false)).toBe(true);
    }
  });
  it('does not nag after dismissal or when a service is already configured', () => {
    const info = { platform: 'linux' };
    expect(shouldAskStratz(info, provider, true)).toBe(false);
    expect(shouldAskStratz(info, { ...provider, serviceConfigured: true }, false)).toBe(false);
    expect(shouldAskStratz(info, { ...provider, connectable: false }, false)).toBe(false);
  });
  it('does not prompt during ordinary isolated tests or on unsupported systems', () => {
    expect(shouldAskStratz({ platform: 'linux', readerPrompt: false }, provider, false)).toBe(false);
    expect(shouldAskStratz({ platform: 'darwin' }, provider, false)).toBe(false);
    expect(shouldAskStratz(undefined, provider, false)).toBe(false);
  });
});
