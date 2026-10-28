import { matchWon, rankName, type Hero, type Note, type PlayerSummary } from '../shared/domain';
import { averageKda } from '../shared/history';
import type { Meetings } from '../shared/meetings';
import { mainPosition, matchPosition } from '../shared/roles';
import { Avatar, Portrait } from './MatchScreen';
import { RoleIcon } from './Roles';
import { NoteEditor } from './NoteEditor';

/** Newest matches listed; few, so the card stays readable over the game. */
const RECENT = 6;

const percent = (wins: number, games: number) => (games ? `${Math.round((wins / games) * 100)}%` : '—');
const side = ({ games, wins }: Meetings['ally']) => `${wins}–${games - wins}`;

/**
 * Hover preview of a match player, on its name: note, earlier
 * meetings and the newest matches of the period already loaded for the table, so
 * hovering never sends a request. The pointer can move onto the card: the note can be
 * written there, a click on a match opens it on STRATZ, anywhere else the full card.
 */
export function PlayerPreview({
  accountId,
  name,
  noteName = '',
  summary,
  note,
  met,
  heroes,
  onOpen,
  onMatch,
}: {
  /** With an account, the note is editable in the card. */
  accountId?: string;
  name: string;
  /** Name saved with a new note: the game or Steam name, never a placeholder. */
  noteName?: string;
  summary?: PlayerSummary;
  note?: Note;
  met: Meetings | null;
  heroes: Hero[];
  onOpen?(): void;
  onMatch?(matchId: number): void;
}) {
  const matches = [...(summary?.matches ?? [])].sort((a, b) => b.start_time - a.start_time);
  const results = matches.map(matchWon).filter((won) => won !== null);
  const wins = results.filter(Boolean).length;
  const main = mainPosition(matches);
  return (
    <div className="player-preview" onClick={onOpen}>
      <div className="tip-title">
        <Avatar url={summary?.profile.profile?.avatarfull} />
        <span className="preview-who">
          {name}
          <small>{summary ? `${rankName(summary.profile.rank_tier)} · ${summary.source}` : 'No profile data'}</small>
        </span>
      </div>
      {accountId ? (
        // Clicks while writing belong to the note, not to the full card.
        <div className="preview-note" onClick={(event) => event.stopPropagation()}>
          <NoteEditor accountId={accountId} name={noteName} note={note} />
        </div>
      ) : (
        note && <p className={`player-note tag-${note.tag}`}>{note.text}</p>
      )}
      {met && (
        <p className="preview-met">
          Met {met.games.length}: as ally {side(met.ally)}, as opponent {side(met.enemy)}
        </p>
      )}
      {!summary ? (
        <p className="muted">Statistics are not loaded.</p>
      ) : !matches.length ? (
        <p className="muted">
          {summary.isPublic === false || summary.historyUnavailable
            ? 'Match data is hidden in this profile.'
            : `No matches in the last ${summary.days} days.`}
        </p>
      ) : (
        <>
          <dl className="tip-rows">
            <dt>
              {matches.length} matches · {summary.days} days
            </dt>
            <dd className={wins * 2 >= results.length ? 'green' : 'error-text'}>{percent(wins, results.length)}</dd>
            <dt>Average K/D/A</dt>
            <dd>{averageKda(matches)}</dd>
            {main && (
              <>
                <dt>Main role</dt>
                <dd>
                  <RoleIcon position={main.position} /> {Math.round(main.share * 100)}%
                </dd>
              </>
            )}
          </dl>
          <ul className="preview-matches">
            {matches.slice(0, RECENT).map((match) => {
              const won = matchWon(match);
              const hero = heroes.find((item) => item.id === match.hero_id);
              const known = [match.kills, match.deaths, match.assists].every((value) => typeof value === 'number');
              return (
                <li
                  key={match.match_id}
                  onClick={(event) => {
                    if (!onMatch) return;
                    event.stopPropagation();
                    onMatch(match.match_id);
                  }}
                >
                  <Portrait hero={hero} />
                  <span className="preview-hero">{hero?.localized_name ?? `#${match.hero_id}`}</span>
                  <RoleIcon position={matchPosition(match)} />
                  <span className="preview-kda">{known ? `${match.kills}/${match.deaths}/${match.assists}` : '—'}</span>
                  <b className={won === null ? 'muted' : won ? 'green' : 'error-text'}>
                    {won === null ? '—' : won ? 'W' : 'L'}
                  </b>
                  <small>
                    {new Date(match.start_time * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </small>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <div className="tip-note">
        {matches.length && onMatch
          ? 'Click a match for STRATZ, elsewhere for the full card'
          : 'Click for the full card'}
      </div>
    </div>
  );
}
