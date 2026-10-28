import { useState } from 'react';
import { formatDecimal, winRateTone } from '../shared/domain';
import type { MetaPick } from '../shared/meta-picks';
import { rankedRoles, type Position } from '../shared/roles';
import { RoleIcon } from './Roles';
import { Portrait } from './MatchScreen';
import { MetaTip } from './Tips';
import { tip } from './Tooltip';

export function MetaPicks({
  rows,
  message,
  note,
}: {
  rows: Record<Position, MetaPick[]>;
  message?: string;
  /** Data provenance, e.g. "STRATZ, all ranks · updated …". */
  note?: string;
}) {
  const [position, setPosition] = useState<Position>(1);
  return (
    <div className="meta-panel">
      <div className="meta-roles" role="group" aria-label="Meta picks position">
        {rankedRoles.map((role) => (
          <button
            key={role.id}
            aria-label={role.name}
            title={`${role.name} · ${role.title}`}
            aria-pressed={position === role.id}
            onClick={() => setPosition(role.id)}
          >
            <RoleIcon position={role.id} />
          </button>
        ))}
      </div>
      <h3 title={note}>{rankedRoles.find((role) => role.id === position)!.name}</h3>
      {message ? (
        <p className="rail-empty" role="status">
          {message}
        </p>
      ) : !rows[position].length ? (
        <p className="rail-empty">No heroes play this position often enough</p>
      ) : (
        <div className="meta-picks">
          {rows[position].map((pick) => (
            <div
              className={`meta-tile${pick.banned ? ' banned' : ''}`}
              key={pick.hero.id}
              data-hero-id={pick.hero.id}
              {...tip(<MetaTip pick={pick} note={note} />)}
              aria-label={`${pick.hero.localized_name}${pick.banned ? ' · banned' : ''} · ${pick.games.toLocaleString('en-US')} matches in this position (a main position: ≥20% of its games) · ranked by win rate adjusted for sample size${note ? ` · ${note}` : ''}`}
            >
              {pick.banned ? (
                <span className="ban-portrait">
                  <Portrait hero={pick.hero} />
                </span>
              ) : (
                <Portrait hero={pick.hero} />
              )}
              <span>{pick.hero.localized_name}</span>
              <b className={`win-rate ${winRateTone(pick.wins, pick.games)}`}>{formatDecimal(pick.winRate)}%</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
