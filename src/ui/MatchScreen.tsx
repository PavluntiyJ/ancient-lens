import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { type LivePlayer, type LiveState, type Note, type StatsDays } from '../shared/domain';
import { AnalysisCarousel } from './DraftPanels';
import { laneSummary } from '../shared/lane-summary';
import { hasNativeReader } from '../shared/reader-notice';
import { useOwnHistory } from './match/useOwnHistory';
import { usePartyHistory } from './match/usePartyHistory';
import { useStratzProvider } from './match/useStratzProvider';
import { useBracketChoice } from './match/useBracketChoice';
import { useDraftData } from './match/useDraftData';
import { useHeroes } from './match/useHeroes';
import { useLaneChoice } from './match/useLaneChoice';
import { analysisPages } from './match/analysisPages';
import { MatchNotices } from './match/MatchNotices';
import { MatchTable } from './match/MatchTable';
import { MatchToolbar } from './match/MatchToolbar';
import { draftPickIds } from './match/draftPicks';
import { laneHeroesOf, teamRolesOf } from './match/teamRoles';
import { useDraftAdvice } from './match/useDraftAdvice';
import { usePlayerEntries } from './match/usePlayerEntries';
import { useSynergyWeight, useMinWinRate, useStatsFilter, useEncounterSound } from './preferences';
import { Announcer, notedPlayers } from '../shared/encounters';
import { playChime } from './sound';
import { visibleDraftSlots, visibleDraftBans, visibleDraftHovers, visibleDraftPicks } from '../shared/live-draft';
import { PlayerCard } from './PlayerCard';
import type { NoteContext } from './NoteEditor';
import { findParties } from '../shared/parties';
import { StratzPrompt } from './StratzPrompt';
import { holdMatch, type HeldMatch } from '../shared/match-session';
import { type SteamSetup } from '../shared/steam-setup';
import type { SettingsSection } from './settings/sections';

/** Width of the analysis strip (CSS px) from which it holds three panels instead of two:
 * each panel then still gets its full content width (440px, plus 84px of arrows and
 * padding, and two 12px gaps). Narrower, two panels show larger tiles than three would. */
const WIDE_STRIP = 3 * (440 + 84) + 2 * 12;

export function MatchScreen({
  ownAccountId,
  platform,
  active,
  providerRevision,
  live: liveInput,
  connected: connectedInput,
  notes,
  recordedMatches = 0,
  ownMmr,
  steamSetup,
  setup,
  openTool,
  connectStratz,
  openNotes,
}: {
  ownAccountId: string;
  platform?: string;
  active: boolean;
  providerRevision: number;
  live: LiveState;
  connected: boolean;
  notes: Note[];
  /** Matches of the own account in the local journal; a new one refreshes "already met". */
  recordedMatches?: number;
  /** Own seasonal MMR read from the game, for the rank bracket when the medal is hidden. */
  ownMmr?: number | null;
  steamSetup?: SteamSetup;
  /** Opens Settings at a section. */
  setup(section?: SettingsSection): void;
  /** Opens the manual draft or the manual roster. */
  openTool?(page: 'draft' | 'roster'): void;
  /** Opens the Connect STRATZ prompt. */
  connectStratz?(): void;
  /** Shows a player on the Notes page. */
  openNotes?(accountId: string): void;
}) {
  // Leaving a match must not wipe the roster and draft: a running player match waits for
  // a reconnect, any other last match (spectated, finished) stays until a new one appears.
  const heldMatch = useRef<HeldMatch | undefined>(undefined);
  const [released, setReleased] = useState<string>();
  const continuity = holdMatch(
    heldMatch.current?.live.matchId === released ? undefined : heldMatch.current,
    liveInput,
    connectedInput,
    Date.now(),
  );
  heldMatch.current = continuity.held;
  const live = continuity.view;
  const { ownHistory, ownTier } = useOwnHistory(ownAccountId, recordedMatches, live.matchId);
  const lingering = continuity.lingering;
  const connected = connectedInput || continuity.suspended || lingering;
  // A frozen snapshot is shown as of its own moment, so the live 15 s freshness rule
  // does not drop its draft after post-game, a disconnect or leaving the match.
  const draftNow = continuity.frozen ? (live.draft?.observedAt ?? live.receivedAt ?? Date.now()) : Date.now();
  const phase = continuity.phase ?? live.gameState;
  const [days, setDays] = useState<StatsDays>(() => {
    const value = Number(localStorage.getItem('stats-days'));
    return [7, 14, 30, 90].includes(value) ? (value as StatsDays) : 14;
  });
  const filter = useStatsFilter();
  // A wide window fits a third analysis panel, so more is visible without paging.
  const strip = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWide(element.clientWidth >= WIDE_STRIP));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const filterKey = `${filter.mode}-${filter.rankedOnly}`;
  const synergyWeight = useSynergyWeight();
  const minWinRate = useMinWinRate();
  const { stratzDraft, stratzConnectable } = useStratzProvider(providerRevision);
  const [selected, setSelected] = useState<string>();
  const [revision, setRevision] = useState(0);
  // Shown by the draft panels; the hero list and the draft requests both report into it.
  const [draftError, setDraftError] = useState('');
  const nativeDraftEnabled =
    hasNativeReader(platform) &&
    live.rosterStatus !== 'disabled' &&
    live.draftStatus !== 'disabled' &&
    (live.draftStatus === 'ready' || live.rosterStatus !== undefined);
  const anonymousDraft =
    nativeDraftEnabled &&
    connected &&
    live.mode === 'player' &&
    live.gameState === 'DOTA_GAMERULES_STATE_HERO_SELECTION';
  const players = anonymousDraft ? [] : (live.players ?? []);
  const partialPlayerRoster = live.mode === 'player' && players.length < 10;
  const ids = [...new Set(players.flatMap((player) => (player.accountId ? [player.accountId] : [])))].sort().join(',');
  const match = live.matchId ?? '';
  const selfTeam = live.mode === 'player' ? live.players?.find((player) => player.key === 'self')?.team : undefined;
  // Own side first; spectators start with Radiant. Each side has its own suggestion page.
  const ownSide = selfTeam ?? 'radiant';
  const otherSide = ownSide === 'radiant' ? 'dire' : 'radiant';
  // The match status shares the window's title bar, so the table starts one row higher.
  const [titleBar, setTitleBar] = useState<HTMLElement | null>(null);
  useEffect(() => setTitleBar(document.getElementById('titlebar-match')), []);
  // Parties, once identities are shown: from the roster's recent public history (STRATZ service).
  const partyHistory = usePartyHistory(match, ids, connected);
  const parties =
    partyHistory !== undefined
      ? findParties(
          players.flatMap((player) => (player.accountId ? [{ accountId: player.accountId, team: player.team }] : [])),
          partyHistory,
          match,
        )
      : [];
  const inTitleBar = (toolbar: ReactNode) => (titleBar ? active && createPortal(toolbar, titleBar) : toolbar);
  const encounterSound = useEncounterSound();
  const announcer = useRef(new Announcer());
  useEffect(() => {
    // A match on screen now, played or spectated; not a reconnect wait or the last match.
    if (!connectedInput || lingering || !match || match === '0') return;
    const list = ids ? ids.split(',') : [];
    const kind = announcer.current.next(match, list, notedPlayers(list, ownAccountId, notes));
    if (kind && encounterSound) playChime(kind);
  }, [connectedInput, lingering, match, ids, ownAccountId, notes, encounterSound]);
  const heroes = useHeroes(connected, revision, setDraftError);
  // A new roster, match, period, provider or refresh closes the open player card.
  useEffect(() => setSelected(undefined), [ids, match, connected, revision, days, providerRevision, filter, filterKey]);
  const entries = usePlayerEntries({ ids, match, connected, revision, days, filter, providerRevision });
  const heroOf = (player: LivePlayer) =>
    heroes.find((hero) => hero.id === player.heroId || (!!player.heroName && hero.name === player.heroName));
  // A note written in a card keeps the live match, the player's hero and side.
  const noteContext = (accountId: string): NoteContext | undefined => {
    const player = live.players?.find((item) => item.accountId === accountId);
    if (!live.matchId || live.matchId === '0' || !player) return undefined;
    return {
      matchId: live.matchId,
      heroId: heroOf(player)?.id,
      ally: selfTeam && player.team ? player.team === selfTeam : undefined,
    };
  };
  const livePicks = visibleDraftPicks(live, connected, draftNow);
  const liveBans = visibleDraftBans(live, connected, draftNow);
  const liveHovers = visibleDraftHovers(live, connected, draftNow);
  const draftSlots = visibleDraftSlots(live, connected, draftNow);
  // The suggestion lane follows the own assigned role once per match.
  const ownLanes = [...draftSlots.radiant, ...draftSlots.dire].find((row) => row.isSelf)?.lanes ?? [];
  const ownPosition = ownLanes.length === 1 ? ownLanes[0] : undefined;
  const { lane, setLane } = useLaneChoice(match, active, ownPosition);
  const picks = draftPickIds(livePicks, liveHovers, liveBans, heroes);
  const { pickedIds } = picks;
  // Hero statistics for the match's rank bracket.
  const bracket = useBracketChoice({
    match,
    player: live.mode === 'player',
    matchTiers: players.map(
      (player) => player.rankTier ?? (player.accountId ? entries[player.accountId]?.result?.profile.rank_tier : null),
    ),
    ownTier,
    ownMmr,
  });
  const { draftData, draftBusy } = useDraftData({
    match,
    providerRevision,
    bracket,
    pickedIds,
    heroes,
    phase,
    connected,
    revision,
    stratzDraft,
    error: draftError,
    setError: setDraftError,
  });
  const { recommendations, counters, meta } = useDraftAdvice({ draftData, heroes, picks, synergyWeight });
  const connect = stratzConnectable ? connectStratz : undefined;
  const adviceMessage = !connected
    ? 'Waiting for match data'
    : draftError ||
      (!stratzDraft ? (
        <StratzPrompt feature="Draft statistics" connect={connect} />
      ) : (draftBusy || pickedIds) && !draftData ? (
        'Loading…'
      ) : undefined);
  const loaded = Object.values(entries).filter((entry) => entry.result).length;
  const privateProfiles = Object.values(entries).filter((entry) => entry.result?.isPublic === false).length;
  const updating = Object.values(entries).some((entry) => entry.loading);
  const obsolete = Object.values(entries).some(
    (entry) => entry.result && (entry.result.days !== days || entry.filterKey !== filterKey),
  );
  const roster = { live, draftSlots, anonymousDraft, heroOf };
  const teamRoles = teamRolesOf({ ...roster, entries, draftData });
  const pages = analysisPages({
    match,
    selfTeam,
    ownSide,
    otherSide,
    heroes,
    draftSlots,
    draftData,
    draftBusy,
    draftError,
    stratzDraft,
    connected,
    connect,
    recommendations,
    counters,
    meta,
    lanes: laneSummary(
      laneHeroesOf('radiant', { ...roster, teamRoles }),
      laneHeroesOf('dire', { ...roster, teamRoles }),
      draftData,
      synergyWeight,
    ),
    adviceMessage,
    pickCount: livePicks.length,
    liveHovers,
    lane,
    synergyWeight,
    minWinRate,
  });
  return (
    <section className="match-screen" aria-label="Match and draft">
      {inTitleBar(
        <MatchToolbar
          online={connectedInput && !lingering}
          suspended={continuity.suspended}
          lingering={lingering}
          connected={connected}
          mode={live.mode}
          phase={phase}
          match={match}
          anonymousDraft={anonymousDraft}
          loaded={loaded}
          total={ids ? ids.split(',').length : 0}
          privateProfiles={privateProfiles}
          updating={updating}
          days={days}
          setDays={(value) => {
            localStorage.setItem('stats-days', String(value));
            setDays(value);
          }}
          onRelease={() => setReleased(live.matchId)}
          onRefresh={() => setRevision((value) => value + 1)}
        />,
      )}
      <MatchNotices
        live={live}
        connected={connected}
        suspended={continuity.suspended}
        match={match}
        platform={platform}
        anonymousDraft={anonymousDraft}
        playerCount={players.length}
        partialPlayerRoster={partialPlayerRoster}
        pickCount={livePicks.length}
        steamSetup={steamSetup}
        setup={setup}
        openTool={openTool}
        onRelease={() => setReleased(live.matchId)}
      />
      <div className="match-workspace">
        <MatchTable
          live={live}
          players={players}
          anonymousDraft={anonymousDraft}
          partialPlayerRoster={partialPlayerRoster}
          draftSlots={draftSlots}
          teamRoles={teamRoles}
          parties={parties}
          selfTeam={selfTeam}
          entries={entries}
          ids={ids}
          days={days}
          filterKey={filterKey}
          obsolete={obsolete}
          updating={updating}
          heroes={heroes}
          notes={notes}
          ownAccountId={ownAccountId}
          ownHistory={ownHistory}
          noteContext={noteContext}
          openNotes={openNotes}
          onSelect={setSelected}
        />
        <div className={`analysis-strip${wide ? ' three' : ''}`} ref={strip}>
          {/* A new match resets both panels to their starting pages. */}
          <AnalysisCarousel
            key={`left-${match}`}
            label="Left panel"
            pages={pages}
            initial={0}
            panel="left"
            active={active}
            lane={lane}
            setLane={setLane}
          />
          <AnalysisCarousel
            key={`right-${match}`}
            label="Right panel"
            pages={pages}
            initial={pages.findIndex((page) => page.id === `suggest-${ownSide}`)}
            panel="right"
            active={active}
            lane={lane}
            setLane={setLane}
          />
          {wide && (
            <AnalysisCarousel
              key={`third-${match}`}
              label="Third panel"
              pages={pages}
              initial={Math.max(
                0,
                pages.findIndex((page) => page.id === 'meta'),
              )}
              active={active}
              lane={lane}
              setLane={setLane}
            />
          )}
        </div>
      </div>
      {!anonymousDraft && selected && (
        <PlayerCard
          start={{ id: selected, name: players.find((player) => player.accountId === selected)?.name }}
          heroes={heroes}
          totals={(id) => entries[id]?.result?.total}
          noteOf={(id) => notes.find((note) => note.accountId === id)}
          ownId={ownAccountId}
          ownHistory={ownHistory}
          contextOf={noteContext}
          openNotes={openNotes}
          close={() => setSelected(undefined)}
        />
      )}
    </section>
  );
}
