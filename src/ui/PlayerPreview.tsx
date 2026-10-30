import { matchWon, type Hero, type Match, type Note, type PlayerSummary } from '../shared/domain';
import type { Meetings } from '../shared/meetings';
import { country } from '../shared/country';
import type { RoleGuess } from '../shared/role-guess';
import { mainPosition, matchPosition, rankedRoles } from '../shared/roles';
import { Avatar, CountryFlag, Portrait, RankMedal } from './MatchScreen';
import { RoleIcon } from './Roles';
import { NoteEditor } from './NoteEditor';
import { PlayerLinks } from './PlayerLinks';

/** Earlier matches together listed, newest first. */
const MET = 10;

const percent = (wins: number, games: number) => (games ? `${Math.round((wins / games) * 100)}%` : '—');
const tone = (wins: number, games: number) => (!games ? '' : wins * 2 >= games ? 'green' : 'error-text');
const kda = (row: { kills?: number | null; deaths?: number | null; assists?: number | null }) =>
  [row.kills, row.deaths, row.assists].every((value) => typeof value === 'number')
    ? `${row.kills}/${row.deaths}/${row.assists}`
    : '—';
/** How long ago a match ended, in words. */
function ago(match: Match, now: number) {
  const hours = (now - (match.start_time + match.duration) * 1000) / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min ago`;
  if (hours < 24) return `${Math.round(hours)} ${Math.round(hours) === 1 ? 'hour' : 'hours'} ago`;
  if (hours < 48) return 'yesterday';
  return `${Math.floor(hours / 24)} days ago`;
}
/** The run of equal results ending with the newest match; an unknown result ends it. */
function streak(matches: Match[]) {
  const first = matches[0] ? matchWon(matches[0]) : null;
  if (first === null) return undefined;
  let count = 0;
  for (const match of matches) {
    if (matchWon(match) !== first) break;
    count++;
  }
  return { count, won: first };
}

/**
 * Hover card of a match player, opened from the whole player cell. Blocks, as in the
 * other Dota companions: who (avatar, name, all-time matches, rank, this match's role),
 * facts, the note and site links, the period's matches already loaded for the table
 * (newest first, scrolling inside the card's height), and the earlier matches together
 * from the own history (shown for private profiles too, since they come from the own
 * matches), so hovering never sends a request. The pointer can move onto the card: the
 * note can be written there, a click on a match opens it on STRATZ, anywhere else the
 * full card. Values the providers did not give stay a dash.
 */
export function PlayerPreview({
  accountId,
  name,
  noteName = '',
  summary,
  total,
  note,
  role,
  smurf = false,
  self = false,
  error,
  met,
  heroes,
  onOpen,
  onMatch,
  now = Date.now(),
}: {
  /** With an account, the note is editable in the card. */
  accountId?: string;
  name: string;
  /** Name saved with a new note: the game or Steam name, never a placeholder. */
  noteName?: string;
  summary?: PlayerSummary;
  /** All-time games and wins, when the provider gave them. */
  total?: { games: number; wins: number };
  note?: Note;
  /** This match's role, as the icon in the row shows it. */
  role?: RoleGuess;
  smurf?: boolean;
  /** The player's own account, which gets no note. */
  self?: boolean;
  /** Why the profile did not load. */
  error?: string;
  met: Meetings | null;
  heroes: Hero[];
  onOpen?(): void;
  onMatch?(matchId: number): void;
  now?: number;
}) {
  const matches = [...(summary?.matches ?? [])].sort((a, b) => b.start_time - a.start_time);
  const results = matches.map(matchWon).filter((won) => won !== null);
  const wins = results.filter(Boolean).length;
  const main = mainPosition(matches);
  const run = streak(matches);
  const place = country(summary?.profile.profile?.loccountrycode);
  const steamName = summary?.profile.profile?.personaname;
  const hidden = summary?.isPublic === false || !!summary?.historyUnavailable;
  const roleName = role && rankedRoles.find((item) => item.id === role.position)?.name;
  const together = new Map(met?.games.map((game) => [game.match.match_id, game.ally]) ?? []);
  const metDecided = met?.games.filter((game) => game.won !== null) ?? [];
  const metWins = metDecided.filter((game) => game.won).length;
  // Clicks while writing a note or on a site link belong to that block, not to the full card.
  const keep = (event: { stopPropagation(): void }) => event.stopPropagation();
  return (
    <div className={`player-preview${matches.length ? ' with-matches' : ''}${met ? ' with-met' : ''}`} onClick={onOpen}>
      <div className="preview-main">
        <header className="preview-block preview-head">
          <Avatar url={summary?.profile.profile?.avatarfull}>
            <CountryFlag code={summary?.profile.profile?.loccountrycode} source={summary?.source} />
          </Avatar>
          <div className="preview-who">
            <b>
              {name}
              {smurf && <span className="smurf-badge">SMURF</span>}
            </b>
            <small>
              {total && total.games > 0 ? (
                <>
                  {total.games.toLocaleString('en-US')} matches ·{' '}
                  <span className={tone(total.wins, total.games)}>{percent(total.wins, total.games)}</span>
                </>
              ) : hidden ? (
                'Private profile'
              ) : summary ? (
                `${summary.source} · all-time matches unknown`
              ) : (
                'No profile data'
              )}
            </small>
            {role && roleName && (
              <span className="preview-role">
                <RoleIcon position={role.position} />
                {roleName} · {role.guessed ? 'most probable position' : 'selected in the draft'}
              </span>
            )}
          </div>
          {summary && <RankMedal tier={summary.profile.rank_tier} leaderboard={summary.profile.leaderboard_rank} />}
        </header>
        {error && <p className="preview-block preview-error">Could not load: {error}</p>}
        {hidden && (
          <p className="preview-block preview-hidden">
            <b>Match data is hidden in this profile.</b> Rank and matches stay unknown; your note still work.
          </p>
        )}
        <dl className="preview-block preview-facts">
          <div>
            <dt>Country</dt>
            <dd>{place?.name ?? <span className="muted">—</span>}</dd>
          </div>
          <div>
            <dt>Steam name</dt>
            <dd>{steamName || <span className="muted">—</span>}</dd>
          </div>
          <div>
            <dt>Last {summary?.days ?? 14} days</dt>
            <dd>
              {matches.length ? (
                <>
                  {matches.length} · <span className={tone(wins, results.length)}>{percent(wins, results.length)}</span>
                </>
              ) : (
                <span className="muted">{summary && !hidden ? 'No matches' : '—'}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Streak</dt>
            <dd>
              {run ? (
                <span className={run.won ? 'green' : 'error-text'}>
                  {run.count} {run.won ? (run.count === 1 ? 'win' : 'wins') : run.count === 1 ? 'loss' : 'losses'}
                </span>
              ) : (
                <span className="muted">—</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Main role</dt>
            <dd>
              {main ? (
                <>
                  <RoleIcon position={main.position} /> {Math.round(main.share * 100)}%
                </>
              ) : (
                <span className="muted">—</span>
              )}
            </dd>
          </div>
          <div>
            <dt>With me</dt>
            <dd>
              {met ? (
                <>
                  {met.games.length} ·{' '}
                  <span className={tone(metWins, metDecided.length)}>{percent(metWins, metDecided.length)}</span>
                  <small>
                    {' '}
                    ally {met.ally.games} · enemy {met.enemy.games}
                  </small>
                </>
              ) : (
                <span className="muted">—</span>
              )}
            </dd>
          </div>
        </dl>
        {accountId ? (
          <>
            <div className="preview-block preview-note" onClick={keep}>
              <NoteEditor accountId={accountId} name={noteName} note={note} self={self} />
            </div>
            <div className="preview-block preview-actions" onClick={keep}>
              <PlayerLinks id={accountId} labelled />
            </div>
          </>
        ) : (
          note && <p className="preview-block player-note">{note.text}</p>
        )}
      </div>
      {matches.length > 0 && (
        <section className="preview-block preview-recent" aria-label="Recent matches">
          <h4>Recent matches</h4>
          <ul className="preview-matches">
            {matches.map((match) => {
              const won = matchWon(match);
              const hero = heroes.find((item) => item.id === match.hero_id);
              const known = [match.kills, match.deaths, match.assists].every((value) => typeof value === 'number');
              const ally = together.get(match.match_id);
              return (
                <li
                  key={match.match_id}
                  className={won === null ? undefined : won ? 'won' : 'lost'}
                  onClick={(event) => {
                    if (!onMatch) return;
                    event.stopPropagation();
                    onMatch(match.match_id);
                  }}
                >
                  <Portrait hero={hero} />
                  <RoleIcon position={matchPosition(match)} />
                  <span className="preview-kda">
                    {known ? `${match.kills}/${match.deaths}/${match.assists}` : '—'}
                    {ally !== undefined && <small className="preview-with">{ally ? 'with you' : 'vs you'}</small>}
                  </span>
                  <span className="preview-when">
                    <b className={won === null ? 'muted' : won ? 'green' : 'error-text'}>
                      {won === null ? 'No result' : won ? 'Won' : 'Lost'}
                    </b>
                    <small>{ago(match, now)}</small>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {met && (
        <section className="preview-block preview-recent preview-together" aria-label="Matches with or against me">
          <h4>Matches with / against me</h4>
          <ul className="preview-matches preview-met-list">
            {met.games.slice(0, MET).map((game) => {
              const them = heroes.find((item) => item.id === game.player.hero);
              const mine = heroes.find((item) => item.id === game.match.hero_id);
              return (
                <li
                  key={game.match.match_id}
                  className={game.won === null ? undefined : game.won ? 'won' : 'lost'}
                  onClick={(event) => {
                    if (!onMatch) return;
                    event.stopPropagation();
                    onMatch(game.match.match_id);
                  }}
                >
                  <Portrait hero={them} />
                  <span className="preview-kda">
                    {kda(game.player)}
                    <small>{game.ally ? 'Ally' : 'Enemy'}</small>
                  </span>
                  <Portrait hero={mine} />
                  <span className="preview-kda">
                    {kda(game.match)}
                    <small>Me</small>
                  </span>
                  <span className="preview-when">
                    <small>{ago(game.match, now)}</small>
                    <b className={game.won === null ? 'muted' : game.won ? 'green' : 'error-text'}>
                      {game.won === null ? 'No result' : `${game.ally ? 'We' : 'I'} ${game.won ? 'won' : 'lost'}`}
                    </b>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <div className="tip-note">
        {(matches.length || met) && onMatch
          ? 'Click a match for STRATZ, elsewhere for the full card'
          : 'Click for the full card'}
      </div>
    </div>
  );
}
