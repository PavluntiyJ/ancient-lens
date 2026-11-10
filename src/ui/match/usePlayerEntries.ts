import { useEffect, useRef, useState } from 'react';
import type { PlayerSummary, StatsDays, StatsFilter } from '../../shared/domain';
import { api, errorMessage } from '../App';

/** One roster player's period statistics as they load. */
export type Entry = {
  result?: PlayerSummary;
  error?: string;
  totalsLoading?: boolean;
  totalsError?: string;
  loading?: boolean;
  /** The filter the result was loaded with, so a changed filter can mark it outdated. */
  filterKey?: string;
};

/**
 * Period statistics of every roster player by account, with lifetime totals fetched after a
 * STRATZ summary that lacks them. Within one match and provider a reload keeps the previous
 * results on screen until the new ones arrive; another match or provider starts empty.
 * Answers from before the last change are dropped.
 */
export function usePlayerEntries({
  ids,
  match,
  connected,
  revision,
  days,
  filter,
  providerRevision,
}: {
  /** The roster's account IDs, sorted and comma-joined. */
  ids: string;
  match: string;
  connected: boolean;
  /** Bumped by the refresh button. */
  revision: number;
  days: StatsDays;
  filter: StatsFilter;
  providerRevision: number;
}) {
  const filterKey = `${filter.mode}-${filter.rankedOnly}`;
  const entriesMatch = useRef('');
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  useEffect(() => {
    let active = true;
    const sameMatch = entriesMatch.current === `${match}-${providerRevision}`;
    entriesMatch.current = `${match}-${providerRevision}`;
    setEntries((previous) =>
      Object.fromEntries(
        ids
          .split(',')
          .filter(Boolean)
          .map((id) => [id, { ...(sameMatch ? previous[id] : {}), loading: connected, error: undefined }]),
      ),
    );
    if (!connected || !ids) return;
    // The main process batches STRATZ lookups; OpenDota keeps its rate-limited queue.
    for (const id of ids.split(',')) {
      void api
        .getSummary(id, days, filter)
        .then((result) => {
          if (!active) return;
          const totalsLoading = result.source === 'STRATZ' && !result.total;
          setEntries((previous) => ({ ...previous, [id]: { result, totalsLoading, loading: false, filterKey } }));
          if (totalsLoading)
            void api
              .getTotals(id)
              .then((totals) => {
                if (active)
                  setEntries((previous) => ({
                    ...previous,
                    [id]: { ...previous[id], result: { ...result, total: totals.total }, totalsLoading: false },
                  }));
              })
              .catch((error) => {
                if (active)
                  setEntries((previous) => ({
                    ...previous,
                    [id]: { ...previous[id], result, totalsLoading: false, totalsError: errorMessage(error) },
                  }));
              });
        })
        .catch((error) => {
          if (active)
            setEntries((previous) => ({
              ...previous,
              [id]: { ...previous[id], loading: false, error: errorMessage(error) },
            }));
        });
    }
    return () => {
      active = false;
    };
  }, [ids, match, connected, revision, days, providerRevision, filter, filterKey]);
  return entries;
}
