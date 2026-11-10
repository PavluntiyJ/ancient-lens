import { useCallback, useMemo } from 'react';
import type { Hero } from '../../shared/domain';
import { counterPicks } from '../../shared/counter-picks';
import { scorePositions, type DraftData } from '../../shared/draft';
import { metaPicks } from '../../shared/meta-picks';
import type { DraftPickIds } from './draftPicks';

const list = (ids: string) => (ids ? ids.split(',').map(Number) : []);

/**
 * Pick suggestions for both sides, counter picks against each side and meta picks, scored
 * locally from the same draft data: switching panels or sides never refetches.
 */
export function useDraftAdvice({
  draftData,
  heroes,
  picks: { banIds, confirmedIds, radiantIds, direIds, pickedIds },
  synergyWeight,
}: {
  draftData?: DraftData;
  heroes: Hero[];
  picks: DraftPickIds;
  synergyWeight: number;
}) {
  const idsOf = useCallback(
    (team: 'radiant' | 'dire') => {
      const list = team === 'radiant' ? radiantIds : direIds;
      return list ? list.split(',').map(Number) : [];
    },
    [radiantIds, direIds],
  );
  // Both sides are scored locally from the same draft data; switching panels never refetches.
  const recommendations = useMemo(() => {
    if (!draftData || !pickedIds) return undefined;
    const confirmed = list(confirmedIds);
    const bans = list(banIds);
    const score = (team: 'radiant' | 'dire') =>
      scorePositions(
        heroes,
        draftData,
        idsOf(team),
        idsOf(team === 'radiant' ? 'dire' : 'radiant'),
        bans,
        synergyWeight,
        confirmed,
      );
    return { radiant: score('radiant'), dire: score('dire') };
  }, [draftData, heroes, idsOf, pickedIds, confirmedIds, banIds, synergyWeight]);
  // Counters against a side's heroes, for the other side to pick.
  const counters = useMemo(() => {
    const confirmed = list(confirmedIds);
    const bans = list(banIds);
    return {
      radiant: counterPicks(heroes, draftData, idsOf('radiant'), confirmed, bans),
      dire: counterPicks(heroes, draftData, idsOf('dire'), confirmed, bans),
    };
  }, [heroes, draftData, idsOf, confirmedIds, banIds]);
  const meta = useMemo(
    () => metaPicks(heroes, draftData, list(confirmedIds), list(banIds)),
    [heroes, draftData, confirmedIds, banIds],
  );
  return { recommendations, counters, meta };
}
