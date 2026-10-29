import type { LocalState, Release, ReleaseInfo } from './domain';

/** The release to announce: the check is on, and the user neither skipped it nor put it off
 * (`later`) in this session. */
export function releaseNotice(
  info: ReleaseInfo | undefined,
  local: Pick<LocalState, 'updateCheck' | 'skippedVersion'>,
  later: string | null,
): Release | null {
  const latest = info?.latest;
  if (!latest || local.updateCheck === false) return null;
  return latest.version === local.skippedVersion || latest.version === later ? null : latest;
}
