import { useEffect, useRef, useState } from 'react';
import type { PartyHistory } from '../../shared/domain';
import { PartyLoader } from '../../shared/party-loader';
import { api } from '../App';

/**
 * The roster's recent public history (STRATZ service) that parties are found in, once
 * identities are shown. `undefined` until the current match has an answer; `null` when it has
 * none. `ids` is the sorted, comma-joined roster; a disconnected screen requests nothing.
 */
export function usePartyHistory(match: string, ids: string, connected: boolean) {
  const [partyHistory, setPartyHistory] = useState<{ match: string; history: PartyHistory | null }>();
  const partyLoader = useRef<PartyLoader>(undefined);
  useEffect(() => {
    const loader = new PartyLoader(
      (list) => api.getParties(list),
      (matchId, history) => setPartyHistory({ match: matchId, history }),
    );
    partyLoader.current = loader;
    return () => loader.stop();
  }, []);
  useEffect(() => {
    partyLoader.current?.request(match, connected ? ids.split(',').filter(Boolean) : []);
  }, [match, ids, connected]);
  return partyHistory?.match === match ? partyHistory.history : undefined;
}
