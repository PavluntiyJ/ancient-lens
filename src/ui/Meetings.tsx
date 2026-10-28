import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Hero, Participant } from '../shared/domain';
import type { Meeting, Meetings } from '../shared/meetings';
import { api, errorMessage } from './App';
import { Portrait } from './MatchScreen';

const kda = (p: Pick<Participant, 'kills' | 'deaths' | 'assists'>) =>
  [p.kills, p.deaths, p.assists].every((value) => typeof value === 'number')
    ? `${p.kills}/${p.deaths}/${p.assists}`
    : '?/?/?';
const result = (game: Meeting) =>
  game.won === null ? 'No result' : `${game.ally ? 'We' : 'I'} ${game.won ? 'won' : 'lost'}`;

/**
 * Earlier matches with this player in the own saved history ("matches with/against
 * me"): the count opens a list on hover or focus, and a row opens
 * that match on Dotabuff. Hidden when no meeting is known.
 */
export function MetBadge({ met, heroes }: { met: Meetings | null; heroes: Hero[] }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const closing = useRef<number | undefined>(undefined);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => () => window.clearTimeout(closing.current), []);
  if (!met) return null;
  const open = () => {
    window.clearTimeout(closing.current);
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return;
    // 340px wide, kept inside the window; above the badge when there is no room below.
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 348));
    const below = window.innerHeight - rect.bottom > 300;
    setPlace({ left, top: below ? rect.bottom + 4 : Math.max(8, rect.top - 304) });
  };
  const close = () => {
    window.clearTimeout(closing.current);
    closing.current = window.setTimeout(() => setPlace(null), 150);
  };
  const side = ({ games, wins }: Meetings['ally']) => `${games} (${wins}–${games - wins})`;
  const summary = `Already met: as ally ${side(met.ally)}, as opponent ${side(met.enemy)}. Wins and losses are yours.`;
  return (
    <>
      <button
        ref={anchor}
        className="met-badge"
        aria-label={summary}
        aria-expanded={!!place}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        onClick={open}
      >
        MET {met.games.length}
      </button>
      {place &&
        createPortal(
          <div
            className="met-popover"
            role="dialog"
            aria-label="Earlier matches with this player"
            style={place}
            onMouseEnter={open}
            onMouseLeave={close}
            onFocus={open}
            onBlur={close}
          >
            <MeetingList
              met={met}
              heroes={heroes}
              summary={summary}
              onOpen={(id) => {
                setError('');
                void api.openMatchSite?.(String(id), 'dotabuff').catch((e) => setError(errorMessage(e)));
              }}
            />
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

export function MeetingList({
  met,
  heroes,
  summary,
  onOpen,
}: {
  met: Meetings;
  heroes: Hero[];
  summary: string;
  onOpen(matchId: number): void;
}) {
  const heroOf = (id?: number) => heroes.find((hero) => hero.id === id);
  return (
    <>
      <header>
        <strong>Matches with / against me</strong>
        <small>{summary}</small>
      </header>
      <ul>
        {met.games.map((game) => {
          const own = game.match;
          const date = new Date((own.start_time + own.duration) * 1000).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });
          return (
            <li key={own.match_id}>
              <button
                className={game.ally ? 'ally' : 'enemy'}
                title={`Open match ${own.match_id} on Dotabuff`}
                onClick={() => onOpen(own.match_id)}
              >
                <Portrait hero={heroOf(game.player.hero)} />
                <span className="met-kda">
                  {kda(game.player)}
                  <small>{game.ally ? 'Ally' : 'Enemy'}</small>
                </span>
                <Portrait hero={heroOf(own.hero_id)} />
                <span className="met-kda">
                  {kda({
                    kills: own.kills ?? undefined,
                    deaths: own.deaths ?? undefined,
                    assists: own.assists ?? undefined,
                  })}
                  <small>Me</small>
                </span>
                <span className="met-result">
                  <small>{date}</small>
                  <b className={game.won === null ? 'muted' : game.won ? 'green' : 'error-text'}>{result(game)}</b>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
