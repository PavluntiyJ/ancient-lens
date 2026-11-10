import type { CSSProperties } from 'react';
import { Bookmark, Lock } from 'lucide-react';
import { winRateTone, type Hero, type LivePlayer, type LiveState, type Match, type Note } from '../../shared/domain';
import { heroPerformance } from '../../shared/hero-performance';
import { heroPool, poolExplanation, type PoolTag } from '../../shared/hero-pool';
import { draftSlotPlayer, type VisibleDraftSlot, type visibleDraftSlots } from '../../shared/live-draft';
import { meetings } from '../../shared/meetings';
import { noteCount } from '../../shared/notes';
import { bracketPieces, partyTip, type findParties } from '../../shared/parties';
import { periodStatus, type PeriodStatus } from '../../shared/period-status';
import type { RoleGuess } from '../../shared/role-guess';
import { mainPosition, rankedRoles } from '../../shared/roles';
import { slotColour } from '../../shared/slot-colour';
import { isSmurf, medianMatches, smurfExplanation } from '../../shared/smurf';
import { api } from '../App';
import { InfoHeader, rosterColumns } from '../ColumnInfo';
import { MetBadge } from '../Meetings';
import type { NoteContext } from '../NoteEditor';
import { PartyBracket } from '../PartyBracket';
import { Avatar, CountryFlag, ProBadge, RankMedal } from '../PlayerIdentity';
import { PlayerPreview } from '../PlayerPreview';
import { Portrait } from '../Portrait';
import { useDisplaySettings } from '../preferences';
import { MatchRole, RoleIcon } from '../Roles';
import { FrequentHeroTip } from '../Tips';
import { hide, tip } from '../Tooltip';
import type { Entry } from './usePlayerEntries';

const pct = (wins: number, games: number) => (games ? `${Math.round((wins / games) * 100)}%` : '—');
/** Matches on a hero below which its numbers are dimmed. */
const THIN_SAMPLE = 5;
const noteDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

type Team = 'radiant' | 'dire';

/**
 * The ten-player table: per side a divider and five rows in draft-slot order, each with the
 * player's identity, all-time and period statistics, and the current hero. During an anonymous
 * draft the rows show slots and picks only.
 */
export function MatchTable({
  live,
  players,
  anonymousDraft,
  partialPlayerRoster,
  draftSlots,
  teamRoles,
  parties,
  selfTeam,
  entries,
  ids,
  days,
  filterKey,
  obsolete,
  updating,
  heroes,
  notes,
  ownAccountId,
  ownHistory,
  noteContext,
  openNotes,
  onSelect,
}: {
  /** The match as shown, held across a reconnect. */
  live: LiveState;
  players: LivePlayer[];
  anonymousDraft: boolean;
  /** A player's own match with fewer than ten players known. */
  partialPlayerRoster: boolean;
  draftSlots: ReturnType<typeof visibleDraftSlots>;
  teamRoles: Record<Team, (RoleGuess | undefined)[]>;
  parties: ReturnType<typeof findParties>;
  selfTeam?: string;
  entries: Record<string, Entry>;
  /** The roster's account IDs, sorted and comma-joined. */
  ids: string;
  days: number;
  filterKey: string;
  /** Some rows still show a result of another period or filter. */
  obsolete: boolean;
  updating: boolean;
  heroes: Hero[];
  notes: Note[];
  ownAccountId: string;
  ownHistory: Match[];
  noteContext(accountId: string): NoteContext | undefined;
  openNotes?(accountId: string): void;
  /** Opens a player's card. */
  onSelect(accountId: string | undefined): void;
}) {
  const display = useDisplaySettings();
  const heroOf = (player: LivePlayer) =>
    heroes.find((hero) => hero.id === player.heroId || (!!player.heroName && hero.name === player.heroName));
  const nameOf = (id: number) => heroes.find((hero) => hero.id === id)?.localized_name ?? `#${id}`;
  const matchSummaries = ids.split(',').flatMap((id) => (entries[id]?.result ? [entries[id].result!] : []));
  const median = medianMatches(matchSummaries);
  const smurfs = new Set(
    matchSummaries.filter((player) => isSmurf(player, ownAccountId, median)).map((player) => player.accountId),
  );
  return (
    <div className="match-roster">
      <h1 className="sr-only">Match players</h1>
      <>
        {obsolete && (
          <p className="table-refresh-note">
            {updating ? 'Updating sample.' : 'Could not update the entire sample.'} Previous data is marked in the rows.
          </p>
        )}
      </>
      <div className="table-scroll">
        <table
          className={`match-table ${display.rank ? '' : 'hide-rank'} ${display.totals ? '' : 'hide-totals'} ${display.frequent ? '' : 'hide-frequent'}`}
        >
          <colgroup>
            <col style={{ width: '21%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '7%' }} />
          </colgroup>
          <thead>
            <tr className="column-groups">
              <th colSpan={2 + Number(display.rank) + Number(display.totals)}>Player · all time</th>
              <th colSpan={2 + Number(display.frequent)}>Player · last {days} days</th>
              <th colSpan={3}>Current hero · last {days} days</th>
            </tr>
            <tr>
              <th>
                <InfoHeader label="Player · role" info={rosterColumns.role} />
              </th>
              <th>Rank</th>
              <th>
                <InfoHeader label="Games · WR" info={rosterColumns.totalGames} />
              </th>
              <th>
                <InfoHeader label="With me" info={rosterColumns.withMe} />
              </th>
              <th>
                <InfoHeader label="Games · WR" info={rosterColumns.periodGames(days)} />
              </th>
              <th>
                <InfoHeader label="Main role" info={rosterColumns.mainRole} />
              </th>
              <th>
                <InfoHeader label="Frequent heroes" info={rosterColumns.frequent} />
              </th>
              <th>Hero</th>
              <th>
                <InfoHeader label="Games · WR" info={rosterColumns.heroGames(days, THIN_SAMPLE)} />
              </th>
              <th>
                <InfoHeader label="Role on hero" info={rosterColumns.heroRole} />
              </th>
            </tr>
          </thead>
          {(['radiant', 'dire'] as const).map((team) => {
            const teamPlayers = players.filter((player) => player.team === team).slice(0, 5);
            const roles = teamRoles[team];
            const teamParties = parties.filter((party) => party.team === team);
            const pieces = bracketPieces(
              draftSlots[team].map((row) =>
                anonymousDraft ? undefined : draftSlotPlayer(live, team, row, draftSlots)?.accountId,
              ),
              teamParties,
            );
            const playerName = (id: string) =>
              players.find((player) => player.accountId === id)?.name ||
              entries[id]?.result?.profile.profile?.personaname ||
              `ID ${id}`;
            return (
              <tbody key={team} className={`team-${team}`}>
                <tr className="team-divider">
                  <td colSpan={7 + Number(display.rank) + Number(display.totals) + Number(display.frequent)}>
                    <span />
                    {team === 'radiant' ? 'Radiant' : 'Dire'}
                    {team === selfTeam && <b className="own-team-label"> · your team</b>}
                    <small>
                      {anonymousDraft
                        ? draftSlots[team].filter((row) => row.pick !== undefined).length
                        : teamPlayers.length}
                      /5
                    </small>
                  </td>
                </tr>
                {draftSlots[team].map((draftRow, index) => {
                  const player = anonymousDraft ? undefined : draftSlotPlayer(live, team, draftRow, draftSlots);
                  const draftHeroId = draftRow.pick ?? draftRow.hover;
                  if (!player && (anonymousDraft || draftRow.slot !== undefined))
                    return (
                      <AnonymousDraftRow
                        key={draftRow.teamSlot}
                        row={draftRow}
                        team={team}
                        hero={heroes.find((hero) => hero.id === draftHeroId)}
                        role={roles[index]}
                      />
                    );
                  const entry = player?.accountId ? entries[player.accountId] : undefined;
                  const data = entry?.result;
                  const oldSelection = data && (data.days !== days || entry?.filterKey !== filterKey);
                  const total = data?.total?.games;
                  const period = data?.historyUnavailable ? undefined : data?.heroes;
                  const periodGames = period?.reduce((sum, hero) => sum + hero.games, 0) ?? 0;
                  const periodWins = period?.reduce((sum, hero) => sum + hero.win, 0) ?? 0;
                  const hero = heroes.find((hero) => hero.id === draftHeroId) ?? (player ? heroOf(player) : undefined);
                  const played = period?.find((row) => row.hero_id === hero?.id);
                  // A handful of games on the hero is shown, but not as confident statistics.
                  const thin = !!played && played.games > 0 && played.games < THIN_SAMPLE;
                  const pool = period && data ? heroPool(data.matches, period) : new Map<number, PoolTag>();
                  // Recent spam goes first; otherwise the most played.
                  const top = period
                    ?.filter((hero) => hero.games > 0)
                    .sort(
                      (a, b) =>
                        Number(pool.get(b.hero_id) === 'recent') - Number(pool.get(a.hero_id) === 'recent') ||
                        b.games - a.games,
                    )
                    .slice(0, 3);
                  const note = notes.find((note) => note.accountId === player?.accountId);
                  const met =
                    player?.accountId && player.accountId !== ownAccountId
                      ? meetings(ownHistory, player.accountId, live.matchId)
                      : null;
                  const persona = player?.name || data?.profile.profile?.personaname;
                  const proName = data?.profile.profile?.pro_name || undefined;
                  const name = proName || persona || (player ? 'Name not provided' : '—');
                  const isSelf =
                    draftRow.isSelf ||
                    player?.key === 'self' ||
                    (!!player?.accountId && player.accountId === ownAccountId);
                  const status = !player
                    ? partialPlayerRoster
                      ? 'Not provided by the game'
                      : 'Waiting for player'
                    : !player.accountId
                      ? 'ID not provided by the game'
                      : entry?.error
                        ? 'Could not load'
                        : !data
                          ? 'Queued…'
                          : entry.result?.stale
                            ? 'Cache · stale data'
                            : `${data.source} · ID ${player.accountId}`;
                  return (
                    <tr
                      key={draftRow.teamSlot}
                      data-team-slot={draftRow.teamSlot}
                      data-slot={draftRow.slot}
                      className={`${!player ? 'unavailable' : ''}${isSelf ? ' self-row' : ''}`.trim()}
                    >
                      <td className="player-cell">
                        <PartyBracket
                          pieces={pieces[index] ?? []}
                          tip={(() => {
                            const id = player?.accountId;
                            const party = id && teamParties.find((item) => item.members.includes(id));
                            return party ? partyTip(party, id, playerName) : undefined;
                          })()}
                        />
                        <div
                          className="match-player"
                          {...(player?.accountId
                            ? tip(
                                <PlayerPreview
                                  accountId={player.accountId}
                                  name={name}
                                  noteName={player.name || data?.profile.profile?.personaname || ''}
                                  summary={data}
                                  total={data?.total}
                                  note={note}
                                  role={roles[index]}
                                  smurf={smurfs.has(player.accountId)}
                                  self={isSelf}
                                  error={entry?.error}
                                  met={met}
                                  heroes={heroes}
                                  history={ownHistory}
                                  context={noteContext(player.accountId)}
                                  openNotes={openNotes}
                                  onOpen={() => {
                                    hide();
                                    onSelect(player.accountId);
                                  }}
                                  onMatch={(id) => void api.openMatchSite(String(id), 'stratz').catch(() => {})}
                                />,
                                true,
                                true,
                              )
                            : {})}
                        >
                          <span className="player-slot">{index + 1}</span>
                          <Avatar url={data?.profile.profile?.avatarfull} frame={slotColour(team, draftRow, player)}>
                            <CountryFlag
                              code={data?.profile.profile?.loccountrycode}
                              source={data?.source}
                              id={data && player?.accountId}
                            />
                          </Avatar>
                          <MatchRole
                            role={roles[index]}
                            heroName={hero?.localized_name}
                            lanes={draftRow.lanes}
                            card={!player?.accountId}
                          />
                          <div>
                            <span className="player-name">
                              <button
                                className={`player-link${proName ? ' pro' : ''}`}
                                disabled={!player?.accountId}
                                onClick={() => player?.accountId && onSelect(player.accountId)}
                              >
                                {name}
                              </button>
                              {proName && <ProBadge name={proName} />}
                              {isSelf && <span className="self-badge">YOU</span>}
                              {player?.accountId && smurfs.has(player.accountId) && (
                                <span className="smurf-badge" title={smurfExplanation} tabIndex={0}>
                                  SMURF
                                </span>
                              )}
                              {note && (
                                <span
                                  title={`${note.text}

${noteCount(note.entries.length)} · latest of ${noteDate(note.updatedAt)}`}
                                  className="note-marker"
                                >
                                  <Bookmark size={15} fill="currentColor" />
                                </span>
                              )}
                            </span>
                            {proName && persona && persona !== proName && (
                              <small className="persona-name" title="Name in Dota">
                                {persona}
                              </small>
                            )}
                            {oldSelection && (
                              <small className="previous-selection">Previous sample · {data.days} days</small>
                            )}
                            <small title={entry?.error ?? entry?.result?.warning}>
                              {data ? (data.warning ? 'Incomplete data' : '') : status}
                            </small>
                            {data && (
                              <small
                                className={entry?.result?.stale ? 'data-age stale' : 'data-age'}
                                title={new Date(data.fetchedAt).toLocaleString('en-US')}
                              >
                                {status}
                              </small>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="rank-cell">
                        {data ? (
                          <RankMedal tier={data?.profile.rank_tier} leaderboard={data?.profile.leaderboard_rank} />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="all-time" title={entry?.totalsError ?? `Overall statistics ${data?.source ?? ''}`}>
                        {total == null ? (
                          <span className="muted">
                            {!player?.accountId
                              ? '—'
                              : entry?.totalsLoading
                                ? '…'
                                : entry?.error || data
                                  ? 'No data'
                                  : '…'}
                          </span>
                        ) : total === 0 ? (
                          <span className="muted">No history</span>
                        ) : (
                          <>
                            {total.toLocaleString('en-US')}
                            <small className={`win-rate ${winRateTone(data!.total!.wins, total, true)}`}>
                              {pct(data!.total!.wins, total)}
                            </small>
                          </>
                        )}
                      </td>
                      <td className="with-me">
                        {met ? <MetBadge met={met} heroes={heroes} /> : <span className="muted">—</span>}
                      </td>
                      <td title={entry?.error}>
                        {period && data && periodGames === 0 && data.limited ? (
                          <span className="muted" title="History is incomplete: matching games may be further back.">
                            No games in this sample
                          </span>
                        ) : period && data && periodGames === 0 ? (
                          <EmptyPeriod status={periodStatus(data, 0)} />
                        ) : period && data ? (
                          <>
                            {periodGames}
                            {data.limited || data.isPublic === false ? '+' : ''}
                            {data.isPublic === false && (
                              <Lock className="period-private" size={11} aria-label="Private profile">
                                <title>
                                  Private profile: only some matches are visible, so the real number may be higher.
                                </title>
                              </Lock>
                            )}
                            <small className={`win-rate ${winRateTone(periodWins, periodGames)}`}>
                              {pct(periodWins, periodGames)}
                            </small>
                          </>
                        ) : (
                          <span className="muted">
                            {entry?.error || data?.historyUnavailable ? 'Unavailable' : data ? 'Loading…' : '—'}
                          </span>
                        )}
                      </td>
                      <td className="position-cell">
                        <PositionShare matches={period && periodGames > 0 ? data?.matches : undefined} />
                      </td>
                      <td>
                        <div className="frequent-heroes">
                          {top?.length
                            ? top.map((row) => {
                                const performance = heroPerformance(row.win, row.games);
                                const tag = pool.get(row.hero_id);
                                const label = `${nameOf(row.hero_id)} · ${row.games} matches · ${pct(row.win, row.games)} wins${tag ? `\n${poolExplanation[tag]}` : ''}`;
                                return (
                                  <span
                                    key={row.hero_id}
                                    className={`hero-performance ${performance.tone}${tag ? ` pool-${tag}` : ''}`}
                                    style={{ '--hero-strength': performance.intensity } as CSSProperties}
                                    {...tip(
                                      <FrequentHeroTip
                                        hero={heroes.find((hero) => hero.id === row.hero_id)}
                                        games={row.games}
                                        wins={row.win}
                                        pool={tag && poolExplanation[tag]}
                                      />,
                                    )}
                                    aria-label={label}
                                    tabIndex={0}
                                  >
                                    <Portrait hero={heroes.find((hero) => hero.id === row.hero_id)} />
                                    <small>{row.games}</small>
                                  </span>
                                );
                              })
                            : '—'}
                        </div>
                      </td>
                      <td>
                        <div
                          className="selected-hero"
                          data-hero-id={draftHeroId}
                          title={
                            draftRow.hover && !draftRow.pick
                              ? `hovered${draftRow.hoverBanned ? ' · banned' : ''}`
                              : undefined
                          }
                        >
                          <span className={draftRow.hover && !draftRow.pick ? 'draft-hover' : undefined}>
                            <Portrait hero={hero} fallback={player?.heroName} />
                          </span>
                          {draftRow.hoverBanned && <small className="banned-hover">banned</small>}
                          <span>{hero?.localized_name || player?.hero || (player ? 'Not picked' : '—')}</span>
                        </div>
                      </td>
                      <td title={entry?.error} className={thin ? 'thin-sample' : undefined}>
                        {hero && period && periodGames > 0 ? (
                          <>
                            {played?.games ?? 0}
                            <small className={`win-rate ${winRateTone(played?.win ?? 0, played?.games ?? 0)}`}>
                              {pct(played?.win ?? 0, played?.games ?? 0)}
                            </small>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={`position-cell${thin ? ' thin-sample' : ''}`}>
                        <PositionShare
                          matches={
                            hero && period && periodGames > 0
                              ? data?.matches.filter((match) => match.hero_id === hero.id)
                              : undefined
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}

/** Main position icon with its share. */
const shortDate = (seconds: number) =>
  new Date(seconds * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** An empty period: private profile, a public player who did not play, or unknown visibility. */
function EmptyPeriod({ status }: { status: PeriodStatus }) {
  if (status.kind === 'private')
    return (
      <span
        className="muted"
        title={`Match data is hidden in Dota 2 (Expose Public Match Data is off), so recent activity is unknown.${status.lastMatchAt ? ` Last visible game: ${shortDate(status.lastMatchAt)}.` : ''}`}
      >
        Private profile
      </span>
    );
  if (status.kind === 'idle')
    return (
      <span
        className="muted"
        title={`Counts only the modes selected in Settings · Match statistics. ${status.lastMatchAt ? `Last matching game: ${shortDate(status.lastMatchAt)}` : 'No visible matching games'}`}
      >
        No matching games in {status.days} days
      </span>
    );
  if (status.kind === 'unknown')
    return (
      <span className="muted" title="The provider does not report whether the profile is private.">
        No public matching games in {status.days} days
      </span>
    );
  return null;
}

function PositionShare({ matches }: { matches?: Match[] }) {
  const main = matches ? mainPosition(matches) : undefined;
  if (!main) return <span className="muted">—</span>;
  const role = rankedRoles.find((item) => item.id === main.position)!;
  const label = `${role.name} · ${main.games} of ${main.known} matches with a known position`;
  return (
    <span className="position-share" title={label} aria-label={label}>
      <RoleIcon position={main.position} />
      <small>{Math.round(main.share * 100)}%</small>
    </span>
  );
}

function AnonymousDraftRow({
  row,
  team,
  hero,
  role,
}: {
  row: VisibleDraftSlot;
  team: 'radiant' | 'dire';
  hero?: Hero;
  role?: RoleGuess;
}) {
  const heroId = row.pick ?? row.hover;
  const hovered = row.pick === undefined && row.hover !== undefined;
  const name = hero?.localized_name ?? (heroId === undefined ? '—' : `#${heroId}`);
  return (
    <tr
      className={`anonymous-draft-row${row.isSelf ? ' self-row' : ''}`}
      data-team-slot={row.teamSlot}
      data-slot={row.slot}
    >
      <td>
        <div className="match-player">
          <span className="player-slot">{row.teamSlot + 1}</span>
          <Avatar frame={slotColour(team, row)} />
          <MatchRole role={role} heroName={hero?.localized_name} lanes={row.lanes} />
          <div>
            <span className="player-name muted">{row.isSelf ? 'You' : `Player ${row.teamSlot + 1}`}</span>
          </div>
        </div>
      </td>
      <td className="rank-cell">—</td>
      <td className="all-time">—</td>
      <td className="with-me">—</td>
      <td>—</td>
      <td>—</td>
      <td>—</td>
      <td>
        <div
          className="selected-hero"
          data-hero-id={heroId}
          title={`${name}${hovered ? ' · hovered' : ''}${row.hoverBanned ? ' · banned' : ''}`}
        >
          <span className={hovered ? 'draft-hover' : undefined}>
            <Portrait hero={hero} />
          </span>
          <span>
            {name}
            {row.hoverBanned && <small className="banned-hover">banned</small>}
          </span>
        </div>
      </td>
      <td>—</td>
      <td>—</td>
    </tr>
  );
}
