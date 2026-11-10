import type { ReactNode } from 'react';
import type { Hero } from '../../shared/domain';
import { draftDataNote, type DraftData, type scorePositions } from '../../shared/draft';
import type { counterPicks } from '../../shared/counter-picks';
import type { laneSummary } from '../../shared/lane-summary';
import type { visibleDraftHovers, visibleDraftSlots } from '../../shared/live-draft';
import type { metaPicks } from '../../shared/meta-picks';
import { CounterPicks } from '../CounterPicks';
import { DraftSuggestions, HeroMatchups, LaneSummaryPanel, type AnalysisPage } from '../DraftPanels';
import { MetaPicks } from '../MetaPicks';
import type { useMinWinRate } from '../preferences';

type Team = 'radiant' | 'dire';

/**
 * The pages both analysis carousels page through, in order: matchups, lanes, picks for the own
 * side, picks for the other side, meta, then counters (against the enemy for a player, against
 * both sides for a spectator). All of them read the same draft data; none fetches.
 */
export function analysisPages({
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
  lanes,
  adviceMessage,
  pickCount,
  liveHovers,
  lane,
  synergyWeight,
  minWinRate,
}: {
  match: string;
  selfTeam?: string;
  /** The own side for a player, Radiant for a spectator. */
  ownSide: Team;
  otherSide: Team;
  heroes: Hero[];
  draftSlots: ReturnType<typeof visibleDraftSlots>;
  draftData?: DraftData;
  draftBusy: boolean;
  draftError: string;
  stratzDraft?: boolean;
  connected: boolean;
  /** Opens Connect STRATZ, where it is offered. */
  connect?(): void;
  recommendations?: Record<Team, ReturnType<typeof scorePositions>>;
  counters: Record<Team, ReturnType<typeof counterPicks>>;
  meta: ReturnType<typeof metaPicks>;
  lanes: ReturnType<typeof laneSummary>;
  /** Why a panel has nothing to show yet, if anything. */
  adviceMessage: ReactNode;
  /** Confirmed picks in the draft. */
  pickCount: number;
  liveHovers: ReturnType<typeof visibleDraftHovers>;
  /** The recommendation lane, an index into `draftLanes`. */
  lane: number;
  synergyWeight: number;
  minWinRate: ReturnType<typeof useMinWinRate>;
}): AnalysisPage[] {
  const teamName = (team: 'radiant' | 'dire') => (team === 'radiant' ? 'Radiant' : 'Dire');
  const teamLabel = (team: 'radiant' | 'dire') => <span className={`team-name ${team}`}>{teamName(team)}</span>;
  // A player's own side is named "your team", not by its colour.
  const suggestionPage = (team: 'radiant' | 'dire'): AnalysisPage => ({
    id: `suggest-${team}`,
    name: team === selfTeam ? 'Picks for your team' : `Picks for ${teamName(team)}`,
    title:
      team === selfTeam ? (
        <>
          Picks for <span className={`team-name ${team}`}>your team</span>
        </>
      ) : (
        <>Picks for {teamLabel(team)}</>
      ),
    lane: true,
    busy: draftBusy,
    body: (
      <DraftSuggestions
        rows={recommendations?.[team]}
        lane={lane}
        context={`${match}-${team}`}
        weight={synergyWeight}
        busy={draftBusy}
        error={draftError}
        available={stratzDraft}
        connect={connect}
        picked={pickCount}
        hovered={liveHovers.length}
        partial={connected && pickCount < 10}
        minWinRate={minWinRate.enabled ? minWinRate.value : undefined}
      />
    ),
  });
  const counterPage = (team: 'radiant' | 'dire'): AnalysisPage => ({
    id: `counters-${team}`,
    name: `Counter picks against ${teamName(team)}`,
    title: <>Counter picks against {teamLabel(team)}</>,
    body: (
      <CounterPicks
        rows={counters[team]}
        hovers={liveHovers.filter((pick) => pick.team === team).map((pick) => pick.heroId)}
        message={adviceMessage}
      />
    ),
  });
  // Order: matchups → lanes → own side → other side → meta → counters. A player only
  // needs counters to the enemy; a spectator gets both sides.
  return [
    {
      id: 'matchups',
      name: 'Hero matchups',
      title: 'Hero matchups',
      body: <HeroMatchups data={draftData} radiant={draftSlots.radiant} dire={draftSlots.dire} heroes={heroes} />,
    },
    {
      id: 'lanes',
      name: 'Lanes',
      title: 'Lanes',
      body: <LaneSummaryPanel summary={lanes} heroes={heroes} weight={synergyWeight} note={draftDataNote(draftData)} />,
    },
    suggestionPage(ownSide),
    suggestionPage(otherSide),
    {
      id: 'meta',
      name: 'Meta',
      title: 'Meta picks',
      body: <MetaPicks rows={meta} message={adviceMessage} note={draftDataNote(draftData)} />,
    },
    ...(selfTeam ? [counterPage(otherSide)] : [counterPage('dire'), counterPage('radiant')]),
  ];
}
