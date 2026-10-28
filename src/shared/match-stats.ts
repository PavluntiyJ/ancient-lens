import type { Match } from './domain';

/** Own team's kills: the provider total, else the team score recorded from the game. */
function teamKills(match: Match): number | undefined {
  if (typeof match.team_kills === 'number') return match.team_kills;
  const score = match.player_slot < 128 ? match.radiant_score : match.dire_score;
  return typeof score === 'number' ? score : undefined;
}
/** Kill participation in percent, `(K + A) / team kills`, capped at 100. */
export function killParticipation(match: Match): number | undefined {
  const team = teamKills(match);
  if (team === undefined || typeof match.kills !== 'number' || typeof match.assists !== 'number') return undefined;
  return Math.min(100, ((match.kills + match.assists) / Math.max(team, 1)) * 100);
}
/** Death participation in percent: the share of the own team's deaths. */
export function deathParticipation(match: Match): number | undefined {
  if (typeof match.team_deaths !== 'number' || typeof match.deaths !== 'number') return undefined;
  return (match.deaths / Math.max(match.team_deaths, 1)) * 100;
}
