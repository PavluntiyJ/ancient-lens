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

/**
 * This match's role, the one role icon before the player's name: a lane selected in the
 * draft, or a team-wide guess, drawn dimmer. The lanes a player selected in the draft are
 * named in its card rather than shown as icons of their own.
 */
export function MatchRole({
  role,
  heroName,
  lanes = [],
  card = true,
}: {
  role?: RoleGuess;
  heroName?: string;
  /** Lanes selected in the draft, when the game reports them. */
  lanes?: Position[];
  /** False inside a player cell whose hover card already names the role. */
  card?: boolean;
}) {
  if (!role)
    return (
      // An empty slot of the icon's width, so the names stay in one column.
      <span className="match-role unknown" title="Role unknown: no hero or matches yet" />
    );
  const name = rankedRoles.find((item) => item.id === role.position)!.name;
  const selected = lanes.map((lane) => rankedRoles.find((item) => item.id === lane)?.name ?? lane).join(', ');
  const label = role.guessed
    ? [
        `Likely ${name}`,
        role.player
          ? `${role.player.games} of ${role.player.known} matches with a known position`
          : 'private or no matches',
        ...(role.hero && heroName
          ? [`${heroName}: ${Math.round(role.hero.share * 100)}% of matches in this position`]
          : []),
        ...(lanes.length > 1 ? [`selected in the draft: ${selected}`] : []),
      ].join(' · ')
    : `${name} · selected in the draft`;
  return (
    <span
      className={`match-role${role.guessed ? ' guessed' : ''}`}
      {...(card ? tip(<RoleTip role={role} lanes={selected} />) : {})}
      aria-label={label}
      data-lanes={lanes.length ? lanes.join(',') : undefined}
    >
      <RoleIcon position={role.position} />
    </span>
  );
}
