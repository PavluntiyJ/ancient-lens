import type { Hero, LivePlayer, LiveState } from '../../shared/domain';
import type { DraftData } from '../../shared/draft';
import type { LaneHero } from '../../shared/lane-summary';
import { draftSlotPlayer, type visibleDraftSlots } from '../../shared/live-draft';
import { guessTeamRoles, type RoleGuess } from '../../shared/role-guess';
import type { Entry } from './usePlayerEntries';

type Team = 'radiant' | 'dire';
type Slots = ReturnType<typeof visibleDraftSlots>;
type Roster = {
  live: LiveState;
  draftSlots: Slots;
  /** Players are hidden during an anonymous draft. */
  anonymousDraft: boolean;
  heroOf(player: LivePlayer): Hero | undefined;
};

/** One role per player across each team, from period history and the hero's positions. */
export function teamRolesOf({
  entries,
  draftData,
  ...roster
}: Roster & { entries: Record<string, Entry>; draftData?: DraftData }): Record<Team, (RoleGuess | undefined)[]> {
  const { live, draftSlots, anonymousDraft, heroOf } = roster;
  const rolesFor = (team: Team) =>
    guessTeamRoles(
      draftSlots[team].map((draftRow) => {
        const player = anonymousDraft ? undefined : draftSlotPlayer(live, team, draftRow, draftSlots);
        const data = player?.accountId ? entries[player.accountId]?.result : undefined;
        const games = data?.historyUnavailable ? 0 : (data?.heroes.reduce((sum, hero) => sum + hero.games, 0) ?? 0);
        return {
          heroId:
            draftRow.pick ??
            (draftRow.hoverBanned ? undefined : draftRow.hover) ??
            (player ? heroOf(player)?.id : undefined),
          matches: games > 0 ? data?.matches : undefined,
          lanes: draftRow.lanes,
        };
      }),
      draftData?.positions ?? [],
    );
  return { radiant: rolesFor('radiant'), dire: rolesFor('dire') };
}

/** Heroes of a team at their role for the lane page; a hover counts as tentative. */
export function laneHeroesOf(
  team: Team,
  { teamRoles, ...roster }: Roster & { teamRoles: Record<Team, (RoleGuess | undefined)[]> },
): LaneHero[] {
  const { live, draftSlots, anonymousDraft, heroOf } = roster;
  return draftSlots[team].flatMap((draftRow, index) => {
    const role = teamRoles[team][index];
    const player = anonymousDraft ? undefined : draftSlotPlayer(live, team, draftRow, draftSlots);
    const heroId =
      draftRow.pick ?? (draftRow.hoverBanned ? undefined : draftRow.hover) ?? (player ? heroOf(player)?.id : undefined);
    if (!role || heroId === undefined) return [];
    return [
      {
        heroId,
        position: role.position,
        guessed: role.guessed,
        hovered: draftRow.pick === undefined && draftRow.hover === heroId,
      },
    ];
  });
}
