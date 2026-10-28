import { formatDecimal } from '../shared/domain';
import type { EnemyCounters } from '../shared/counter-picks';
import { Portrait } from './MatchScreen';
import { CounterTip } from './Tips';
import { tip } from './Tooltip';

export function CounterPicks({ rows, hovers, message }: { rows: EnemyCounters[]; hovers: number[]; message?: string }) {
  return (
    <div className="counter-panel">
      {message ? (
        <p className="rail-empty" role="status">
          {message}
        </p>
      ) : !rows.length ? (
        <p className="rail-empty">Waiting for enemy heroes</p>
      ) : (
        <>
          <div className="counter-rows">
            {rows.map((row) => (
              <div className="counter-row" key={row.enemy.id} data-enemy-id={row.enemy.id}>
                <div
                  className={`counter-enemy${hovers.includes(row.enemy.id) ? ' draft-hover' : ''}`}
                  title={row.enemy.localized_name}
                >
                  <Portrait hero={row.enemy} />
                  {hovers.includes(row.enemy.id) && <small>hovered</small>}
                </div>
                <div className="counter-candidates">
                  {row.counters.length ? (
                    row.counters.map((pick) => (
                      <span
                        key={pick.hero.id}
                        data-hero-id={pick.hero.id}
                        tabIndex={0}
                        className={`counter-tile${pick.multiple ? ' multiple' : ''}`}
                        {...tip(
                          <CounterTip
                            hero={pick.hero}
                            enemy={row.enemy}
                            advantage={pick.advantage}
                            multiple={pick.multiple}
                          />,
                        )}
                        aria-label={`${pick.hero.localized_name} · ${formatDecimal(pick.advantage, 2)} pp against ${row.enemy.localized_name}${pick.multiple ? ' · against multiple heroes' : ''}`}
                      >
                        <Portrait hero={pick.hero} />
                        <b>
                          {pick.advantage > 0 ? '+' : ''}
                          {formatDecimal(pick.advantage)}
                        </b>
                        {pick.multiple && <span className="sr-only">against multiple heroes</span>}
                      </span>
                    ))
                  ) : (
                    <span className="muted">No data</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          {rows.some((row) => row.counters.some((pick) => pick.multiple)) && (
            <small className="counter-legend">● against multiple heroes</small>
          )}
        </>
      )}
    </div>
  );
}
