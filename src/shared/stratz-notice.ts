import type { AppInfo, ProviderInfo } from './domain';

/** Offer the optional provider once, independently of the memory-reader decision. */
export function shouldAskStratz(
  info: Pick<AppInfo, 'platform' | 'readerPrompt'> | undefined,
  provider: ProviderInfo,
  asked: boolean,
): boolean {
  return (
    !!info &&
    ['linux', 'win32'].includes(info.platform) &&
    info.readerPrompt !== false &&
    !!provider.connectable &&
    !provider.serviceConfigured &&
    !asked
  );
}
