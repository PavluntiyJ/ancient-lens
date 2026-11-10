import { useEffect, useRef, useState } from 'react';
import type { Hero } from '../../shared/domain';
import { draftWarmBatches, mergeDraft, missingDraftIds, type DraftData, type DraftStore } from '../../shared/draft';
import type { RankBracket } from '../../shared/rank-bracket';
import { api, errorMessage } from '../App';

const DRAFT_PHASES = [
  'DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD',
  'DOTA_GAMERULES_STATE_HERO_SELECTION',
  'DOTA_GAMERULES_STATE_STRATEGY_TIME',
];

/**
 * STRATZ draft statistics (matchups, synergies, positions) for the match's heroes in its
 * bracket. Data is kept per scope (match, provider, bracket): only heroes the scope has not
 * asked for yet are requested, and until they arrive the panels keep what the scope has.
 * During the draft every hero's data is fetched once per scope in the background, so later
 * hovers and picks need no request. Late replies from another scope are dropped.
 *
 * `error` is shared with the hero list (`useHeroes`): either can fail, and every new draft
 * request clears it. While it is set, no draft data is shown.
 */
export function useDraftData({
  match,
  providerRevision,
  bracket,
  pickedIds,
  heroes,
  phase,
  connected,
  revision,
  stratzDraft,
  error,
  setError,
}: {
  match: string;
  providerRevision: number;
  bracket: RankBracket;
  /** Picked and hovered heroes of both sides, sorted and comma-joined. */
  pickedIds: string;
  heroes: Hero[];
  /** The game state; the background fetch runs during the draft only. */
  phase?: string;
  connected: boolean;
  /** Bumped by the refresh button. */
  revision: number;
  /** STRATZ answers draft requests; `undefined` until known. */
  stratzDraft?: boolean;
  error: string;
  setError(message: string): void;
}) {
  const [draftStore, setDraftStore] = useState<DraftStore>();
  const draftScopeRef = useRef('');
  const [draftBusy, setDraftBusy] = useState(false);
  const draftScope = `${match}-${providerRevision}-${bracket}`;
  draftScopeRef.current = draftScope;
  // A late reply (warm-up or request) from another match or provider is dropped.
  const addDraft = (scope: string, ids: number[], reply: DraftData) =>
    setDraftStore((previous) => (scope === draftScopeRef.current ? mergeDraft(previous, scope, ids, reply) : previous));
  const missingIds = missingDraftIds(draftStore, draftScope, pickedIds ? pickedIds.split(',').map(Number) : []);
  // Only heroes this match has not asked for yet are requested; until they arrive the
  // panels keep the match's data. Another match, provider or a failed request hides it.
  const draftNeeded =
    draftStore?.scope !== draftScope || missingIds.length > 0 ? `${draftScope}-${missingIds.join(',')}` : '';
  const draftData =
    connected && stratzDraft && draftStore?.scope === draftScope && !error ? draftStore.data : undefined;
  useEffect(() => {
    let active = true;
    setError('');
    setDraftBusy(false);
    if (!connected || stratzDraft === undefined || !draftNeeded) return;
    setDraftBusy(true);
    const scope = draftScope;
    const timer = window.setTimeout(() => {
      if (stratzDraft && api.getDraftData) {
        // Keep the service's ten-ID request limit; an empty request still brings positions.
        const batches = missingIds.length ? draftWarmBatches(missingIds.map((id) => ({ id }))) : [[]];
        void Promise.all(
          batches.map((batch) => api.getDraftData(batch, bracket).then((reply) => addDraft(scope, batch, reply))),
        )
          .catch((error) => {
            if (active) setError(errorMessage(error));
          })
          .finally(() => {
            if (active) setDraftBusy(false);
          });
      } else setDraftBusy(false);
    }, 100);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
    // oxlint-disable-next-line react/exhaustive-deps -- draftNeeded stands for scope and missing IDs; bracket changes the scope.
  }, [draftNeeded, connected, revision, stratzDraft]);
  // Once per match, from loading on, every hero's matchups are fetched into the store (about
  // 13 requests, cached by the service for an hour): later hovers and picks need none.
  const warmedMatch = useRef('');
  const drafting = DRAFT_PHASES.includes(phase ?? '');
  useEffect(() => {
    if (!match || !drafting || !connected || !stratzDraft || !heroes.length) return;
    if (warmedMatch.current === draftScope) return;
    warmedMatch.current = draftScope;
    const scope = draftScope;
    void (async () => {
      for (const batch of draftWarmBatches(heroes)) {
        if (warmedMatch.current !== scope) return;
        try {
          addDraft(scope, batch, await api.getDraftData(batch, bracket));
        } catch {
          // A quota or network error ends the warm-up; regular requests still run.
          return;
        }
      }
    })();
    // oxlint-disable-next-line react/exhaustive-deps -- bracket is part of draftScope; one warm-up per scope.
  }, [draftScope, match, drafting, connected, stratzDraft, heroes]);
  return { draftData, draftBusy };
}
