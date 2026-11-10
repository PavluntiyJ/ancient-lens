import type { Hero } from '../../shared/domain';
import type { visibleDraftBans, visibleDraftHovers, visibleDraftPicks } from '../../shared/live-draft';

/**
 * The draft's heroes as sorted, comma-joined ID lists, so effects and memos change only when
 * the heroes do. Picks and hovers count for each side; heroes the hero list does not know
 * are left out.
 */
export function draftPickIds(
  livePicks: ReturnType<typeof visibleDraftPicks>,
  liveHovers: ReturnType<typeof visibleDraftHovers>,
  liveBans: ReturnType<typeof visibleDraftBans>,
  heroes: Hero[],
) {
  const banIds = (liveBans ?? []).filter((id) => heroes.some((hero) => hero.id === id)).join(',');
  const picksFor = (team: string) => [
    ...new Set(
      [...livePicks, ...liveHovers]
        .filter((pick) => pick.team === team && heroes.some((hero) => hero.id === pick.heroId))
        .map((pick) => pick.heroId),
    ),
  ];
  const confirmedIds = livePicks
    .map((pick) => pick.heroId)
    .sort((a, b) => a - b)
    .join(',');
  const radiantIds = picksFor('radiant').join(',');
  const direIds = picksFor('dire').join(',');
  const pickedIds = [...new Set([...picksFor('radiant'), ...picksFor('dire')])].sort((a, b) => a - b).join(',');
  return { banIds, confirmedIds, radiantIds, direIds, pickedIds };
}
export type DraftPickIds = ReturnType<typeof draftPickIds>;
