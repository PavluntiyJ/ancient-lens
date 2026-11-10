import { useEffect, useState } from 'react';
import type { Match } from '../../shared/domain';
import { api } from '../App';

/**
 * The own account's saved history (provider cache plus match journal) and medal, for "already
 * met" and the rank bracket. Never fetched from the provider here, so a match screen does not
 * spend the history quota. Reloads when the account, the journal or the match changes; an
 * answer for an account that is no longer the own one is dropped.
 */
export function useOwnHistory(ownAccountId: string, recordedMatches: number, matchId: string | undefined) {
  const [ownHistory, setOwnHistory] = useState<Match[]>([]);
  const [ownTier, setOwnTier] = useState<number | null>();
  useEffect(() => {
    let current = true;
    setOwnHistory([]);
    if (!ownAccountId) return;
    void api
      .getHistory(ownAccountId, 0, true)
      .then((value) => {
        if (current && value?.accountId === ownAccountId) {
          setOwnHistory(value.matches);
          setOwnTier(value.profile.rank_tier);
        }
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [ownAccountId, recordedMatches, matchId]);
  return { ownHistory, ownTier };
}
