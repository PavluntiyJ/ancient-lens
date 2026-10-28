import { CircleHelp, Map } from 'lucide-react';
import { rankedRoles, type Position } from '../shared/roles';
import type { RoleGuess } from '../shared/role-guess';
import { RoleTip } from './Tips';
import { tip } from './Tooltip';

const icons = { 1: 'safelane', 2: 'midlane', 3: 'offlane', 4: 'softsupport', 5: 'hardsupport' };
export function RoleIcon({ position }: { position?: Position }) {
  return position ? (
    <img
      className="role-icon"
      src={`./roles/${icons[position]}.png`}
      width={20}
      height={20}
      alt=""
      aria-hidden="true"
    />
  ) : (
    <CircleHelp size={16} aria-hidden="true" />
  );
}

export function RoleLabel({ position }: { position?: Position }) {
  const role = rankedRoles.find((role) => role.id === position);
  return (
    <span
      className={`role-label role-${position ?? 'unknown'}`}
      title={role?.title ?? 'The provider did not identify a position'}
    >
      <RoleIcon position={position} />
      <span>{role?.name ?? 'Unknown'}</span>
    </span>
  );
}

export function LaneIcon({ lane }: { lane: string }) {
  const position = lane === 'safe' ? 1 : lane === 'mid' ? 2 : lane === 'off' ? 3 : undefined;
  return position ? <RoleIcon position={position} /> : <Map size={16} aria-hidden="true" />;
}

/** This match's role: a lane selected in the draft, or a team-wide guess marked as likely. */
export function MatchRole({ role, heroName, days = 14 }: { role?: RoleGuess; heroName?: string; days?: number }) {
  if (!role)
    return (
      <span className="match-role unknown" title="Role unknown: no hero or matches yet">
        —
      </span>
    );
  const name = rankedRoles.find((item) => item.id === role.position)!.name;
  const label = role.guessed
    ? [
        `Likely ${name}`,
        role.player
          ? `${role.player.games} of ${role.player.known} matches with a known position`
          : 'private or no matches',
        ...(role.hero && heroName
          ? [`${heroName}: ${Math.round(role.hero.share * 100)}% of matches in this position`]
          : []),
      ].join(' · ')
    : `${name} · selected in the draft`;
  return (
    <span
      className={`match-role${role.guessed ? ' guessed' : ''}`}
      {...tip(<RoleTip role={role} heroName={heroName} days={days} />)}
      aria-label={label}
    >
      <RoleIcon position={role.position} />
      {role.guessed && <small aria-hidden="true">?</small>}
    </span>
  );
}
