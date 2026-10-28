import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BookOpen, Lock, RefreshCw, Settings, Swords, UserRound } from 'lucide-react';
import {
  formatDuration,
  rankName,
  winRateTone,
  type Hero,
  type LivePlayer,
  type LiveState,
  type Match,
  type ReaderStatus,
  type Note,
  type PlayerSummary,
  type StatsDays,
} from '../shared/domain';
import { api, errorMessage } from './App';
import { PlayerLinks } from './PlayerLinks';
import {
  AnalysisCarousel,
  DraftSuggestions,
  HeroMatchups,
  LaneSummaryPanel,
  shortcutBlocked,
  type AnalysisPage,
} from './DraftPanels';
import { laneSummary, type LaneHero } from '../shared/lane-summary';
import { slotColour } from '../shared/slot-colour';
import { hasNativeReader, readerRisk, readerRiskWindows, showReaderNotice } from '../shared/reader-notice';
import { isSmurf, medianMatches, smurfExplanation } from '../shared/smurf';
import { meetings } from '../shared/meetings';
import { country } from '../shared/country';
import { countryCache } from '../shared/country-cache';
import { MetBadge } from './Meetings';
import { heroPool, poolExplanation, type PoolTag } from '../shared/hero-pool';
import { counterPicks } from '../shared/counter-picks';
import { metaPicks } from '../shared/meta-picks';
import { periodStatus, type PeriodStatus } from '../shared/period-status';
import { MetaPicks } from './MetaPicks';
import { CounterPicks } from './CounterPicks';
import { heroPerformance } from '../shared/hero-performance';
import {
  useSynergyWeight,
  useMinWinRate,
  useStatsFilter,
  useDisplaySettings,
  useEncounterSound,
  useRankBracket,
} from './preferences';
import { Announcer, notedPlayers } from '../shared/encounters';
import { chooseBracket, matchMedalTier, type BracketChoice } from '../shared/rank-bracket';
import { playChime } from './sound';
import {
  draftSlotPlayer,
  visibleDraftSlots,
  visibleDraftBans,
  visibleDraftHovers,
  visibleDraftPicks,
  type VisibleDraftSlot,
} from '../shared/live-draft';
import { MatchRole, RoleIcon } from './Roles';
import { mainPosition, rankedRoles } from '../shared/roles';
import { PlayerCard } from './PlayerCard';
import { PlayerPreview } from './PlayerPreview';
import { FrequentHeroTip } from './Tips';
import { InfoHeader, rosterColumns } from './ColumnInfo';
import { hide, tip } from './Tooltip';
import { useShortcuts } from './shortcut-context';
import { matchesShortcut } from '../shared/shortcuts';
import { guessTeamRoles, type RoleGuess } from '../shared/role-guess';
import {
  draftDataNote,
  draftLanes,
  draftWarmBatches,
  laneForPosition,
  scorePositions,
  mergeDraft,
  missingDraftIds,
  type DraftData,
  type DraftStore,
} from '../shared/draft';
import { holdMatch, type HeldMatch } from '../shared/match-session';
import { connectionHint, type SteamSetup } from '../shared/steam-setup';

const pct = (wins: number, games: number) => (games ? `${Math.round((wins / games) * 100)}%` : '—');
const phaseNames: Record<string, string> = {
  DOTA_GAMERULES_STATE_HERO_SELECTION: 'Hero selection',
  DOTA_GAMERULES_STATE_STRATEGY_TIME: 'Strategy',
  DOTA_GAMERULES_STATE_PRE_GAME: 'Pre-game',
  DOTA_GAMERULES_STATE_GAME_IN_PROGRESS: 'Match in progress',
  DOTA_GAMERULES_STATE_POST_GAME: 'Match finished',
  DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD: 'Loading players',
};
const rosterMessages: Partial<Record<ReaderStatus, string>> = {
  permission: 'The system denied access to Dota memory',
  disabled: 'memory reading off · using GSI',
  unsupported: 'Could not recognize the structures in this Dota version',
  'not-running': 'Waiting for Dota to start',
  'multiple-games': 'Multiple Dota processes detected',
  'waiting-entities': 'Waiting for the current match roster',
  'match-mismatch': 'Checking the current match',
  incomplete: 'Waiting for the full player roster',
  unavailable: 'Updating match roster',
  retrying: 'Retrying roster search',
};
type Entry = {
  result?: PlayerSummary;
  error?: string;
  totalsLoading?: boolean;
  totalsError?: string;
  loading?: boolean;
  filterKey?: string;
};
/** Matches on a hero below which its numbers are dimmed. */
const THIN_SAMPLE = 5;
/** Width of the analysis strip (CSS px) from which it holds three panels instead of two:
 * each panel then still gets its full content width (440px, plus 84px of arrows and
 * padding, and two 12px gaps). Narrower, two panels show larger tiles than three would. */
const WIDE_STRIP = 3 * (440 + 84) + 2 * 12;
/** `frame` is the in-game slot colour, drawn only when the slot order is known. */
export function Avatar({ url, frame }: { url?: string; frame?: { name: string; hex: string; index: number } }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const allowed =
    url &&
    /^https:\/\/(avatars\.(?:steamstatic\.com|akamai\.steamstatic\.com|cloudflare\.steamstatic\.com|steamcommunity\.com))\/[a-f0-9]+(?:_full|_medium)?\.(?:jpg|png)$/i.test(
      url,
    );
  return (
    <span
      className={`player-avatar${frame ? ' slot-frame' : ''}`}
      style={frame && ({ '--slot-colour': frame.hex } as CSSProperties)}
      title={frame && `${frame.name}: player slot ${frame.index + 1} in the game`}
    >
      {allowed && !failed ? (
        <img src={url} alt="Player avatar" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <UserRound size={22} />
      )}
    </span>
  );
}
/** OpenDota country lookups by account, shared by every flag of that player. */
const lookupCountry = countryCache((id) => api.getCountry?.(id) ?? Promise.resolve(null));
/**
 * The Steam profile's country flag; nothing when the player set no location. `code` comes
 * with the loaded profile from `source`; with `id`, a profile without one falls back to the
 * account's OpenDota profile (STRATZ often lacks the country).
 */
export function CountryFlag({ code, source, id }: { code?: string | null; source?: string; id?: string }) {
  const [found, setFound] = useState<{ id: string; code: string | null }>();
  const [failed, setFailed] = useState(false);
  const own = country(code);
  const lookup = !own && id ? id : undefined;
  useEffect(() => {
    if (!lookup) return;
    let active = true;
    void lookupCountry(lookup).then((value) => active && setFound({ id: lookup, code: value }));
    return () => {
      active = false;
    };
  }, [lookup]);
  const fallback = found && found.id === lookup ? country(found.code) : undefined;
  const known = own ?? fallback;
  useEffect(() => setFailed(false), [known?.code]);
  if (!known || failed) return null;
  const via = own ? source : 'OpenDota';
  const label = `Country: ${known.name} · Steam profile${via ? ` via ${via}` : ''}`;
  return (
    <img
      className="country-flag"
      src={known.flag}
      alt={known.name}
      title={label}
      aria-label={label}
      onError={() => setFailed(true)}
    />
  );
}
export function RankMedal({ tier, leaderboard }: { tier?: number | null; leaderboard?: number | null }) {
  const medal = tier && tier >= 10 && tier <= 80 ? Math.floor(tier / 10) : 0;
  const stars = medal > 0 && medal < 8 ? Math.min(5, tier! % 10) : 0;
  const variant = medal === 8 && leaderboard && leaderboard <= 100 ? (leaderboard <= 10 ? '8c' : '8b') : String(medal);
  const label = rankName(tier) + (leaderboard ? ` · #${leaderboard}` : '');
  return (
    <span className="rank-medal" title={label} role="img" aria-label={label}>
      <img src={`./ranks/rank_icon_${variant}.png`} alt="" />
      {stars > 0 && <img className="rank-stars" src={`./ranks/rank_star_${stars}.png`} alt="" />}
      {medal === 8 && leaderboard ? <b>{leaderboard}</b> : null}
    </span>
  );
}
export function Portrait({ hero, fallback }: { hero?: Hero; fallback?: string }) {
  const [failedSource, setFailedSource] = useState<string>();
  const name = hero?.name ?? fallback;
  const slug = name?.replace(/^npc_dota_hero_/, '');
  return (
    <span className="portrait">
      {slug && slug !== failedSource && /^[a-z0-9_]+$/.test(slug) ? (
        <img
          src={`https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${slug}.png`}
          alt=""
          onError={() => setFailedSource(slug)}
        />
      ) : hero ? (
        <span className="portrait-fallback">{hero.localized_name}</span>
      ) : (
        <Swords size={16} />
      )}
    </span>
  );
}

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
  setup(): void;
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
  // Own saved history (provider cache plus match journal) for "already met"; never fetched
  // from the provider here, so a match screen does not spend the history quota.
  const [ownHistory, setOwnHistory] = useState<Match[]>([]);
  const [ownTier, setOwnTier] = useState<number | null>();
  useEffect(() => {
    let current = true;
    setOwnHistory([]);
    if (!ownAccountId) return;
    void api
      .getHistory(ownAccountId, 0, true)
      .then((value) => {
        if (current && value?.accountId === ownAccountId) {
          setOwnHistory(value.matches);
          setOwnTier(value.profile.rank_tier);
        }
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [ownAccountId, recordedMatches, live.matchId]);
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
  const display = useDisplaySettings();
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
  const entriesMatch = useRef('');
  const synergyWeight = useSynergyWeight();
  const minWinRate = useMinWinRate();
  const [stratzDraft, setStratzDraft] = useState<boolean>();
  useEffect(() => {
    let active = true;
    void api
      .getProvider()
      .then((info) => {
        if (active) setStratzDraft(!!info.serviceConfigured);
      })
      .catch(() => {
        if (active) setStratzDraft(false);
      });
    return () => {
      active = false;
    };
  }, [providerRevision]);
  const [selected, setSelected] = useState<string>();
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [lane, setLaneState] = useState(() => {
    const saved = Number(localStorage.getItem('preferred-lane'));
    return Number.isInteger(saved) && saved >= 0 && saved < draftLanes.length ? saved : 0;
  });
  // Match whose lane was already chosen (automatically or by the user).
  const laneDecided = useRef('');
  const currentMatch = useRef('');
  currentMatch.current = live.matchId ?? '';
  const setLane = (index: number) => {
    laneDecided.current = currentMatch.current;
    localStorage.setItem('preferred-lane', String(index));
    setLaneState(index);
  };
  const [revision, setRevision] = useState(0);
  const [draftStore, setDraftStore] = useState<DraftStore>();
  const draftScopeRef = useRef('');
  const [draftError, setDraftError] = useState('');
  const [draftBusy, setDraftBusy] = useState(false);
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
  const encounterSound = useEncounterSound();
  const shortcuts = useShortcuts();
  const announcer = useRef(new Announcer());
  useEffect(() => {
    // A match on screen now, played or spectated; not a reconnect wait or the last match.
    if (!connectedInput || lingering || !match || match === '0') return;
    const list = ids ? ids.split(',') : [];
    const kind = announcer.current.next(match, list, notedPlayers(list, ownAccountId, notes));
    if (kind && encounterSound) playChime(kind);
  }, [connectedInput, lingering, match, ids, ownAccountId, notes, encounterSound]);
  useEffect(() => {
    if (!active) return;
    // The stored keys cycle the lane shared by both panels.
    const keydown = (event: KeyboardEvent) => {
      if (shortcutBlocked(event)) return;
      const direction = matchesShortcut(event, shortcuts.laneNext)
        ? 1
        : matchesShortcut(event, shortcuts.lanePrevious)
          ? -1
          : 0;
      if (!direction) return;
      event.preventDefault();
      laneDecided.current = currentMatch.current;
      setLaneState((index) => {
        const next = (index + direction + draftLanes.length) % draftLanes.length;
        localStorage.setItem('preferred-lane', String(next));
        return next;
      });
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [active, shortcuts.lanePrevious, shortcuts.laneNext]);
  useEffect(() => {
    if (!connected) return;
    let active = true;
    void api
      .getHeroes()
      .then((value) => {
        if (active) setHeroes(value);
      })
      .catch((error) => {
        if (active) setDraftError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [connected, revision]);
  useEffect(() => {
    let active = true;
    const sameMatch = entriesMatch.current === `${match}-${providerRevision}`;
    entriesMatch.current = `${match}-${providerRevision}`;
    setSelected(undefined);
    setEntries((previous) =>
      Object.fromEntries(
        ids
          .split(',')
          .filter(Boolean)
          .map((id) => [id, { ...(sameMatch ? previous[id] : {}), loading: connected, error: undefined }]),
      ),
    );
    if (!connected || !ids) return;
    // The main process batches STRATZ lookups; OpenDota keeps its rate-limited queue.
    for (const id of ids.split(',')) {
      void api
        .getSummary(id, days, filter)
        .then((result) => {
          if (!active) return;
          const totalsLoading = result.source === 'STRATZ' && !result.total && !!api.getTotals;
          setEntries((previous) => ({ ...previous, [id]: { result, totalsLoading, loading: false, filterKey } }));
          if (totalsLoading)
            void api.getTotals!(id)
              .then((totals) => {
                if (active)
                  setEntries((previous) => ({
                    ...previous,
                    [id]: { ...previous[id], result: { ...result, total: totals.total }, totalsLoading: false },
                  }));
              })
              .catch((error) => {
                if (active)
                  setEntries((previous) => ({
                    ...previous,
                    [id]: { ...previous[id], result, totalsLoading: false, totalsError: errorMessage(error) },
                  }));
              });
        })
        .catch((error) => {
          if (active)
            setEntries((previous) => ({
              ...previous,
              [id]: { ...previous[id], loading: false, error: errorMessage(error) },
            }));
        });
    }
    return () => {
      active = false;
    };
  }, [ids, match, connected, revision, days, providerRevision, filter]);
  const heroOf = (player: LivePlayer) =>
    heroes.find((hero) => hero.id === player.heroId || (!!player.heroName && hero.name === player.heroName));
  const livePicks = visibleDraftPicks(live, connected, draftNow);
  const liveBans = visibleDraftBans(live, connected, draftNow);
  const liveHovers = visibleDraftHovers(live, connected, draftNow);
  const draftSlots = visibleDraftSlots(live, connected, draftNow);
  // The suggestion lane follows the own assigned role once per match.
  const ownLanes = [...draftSlots.radiant, ...draftSlots.dire].find((row) => row.isSelf)?.lanes ?? [];
  const ownPosition = ownLanes.length === 1 ? ownLanes[0] : undefined;
  useEffect(() => {
    if (!match || ownPosition === undefined || laneDecided.current === match) return;
    laneDecided.current = match;
    setLaneState(laneForPosition(ownPosition));
  }, [match, ownPosition]);
  const banIds = (liveBans ?? []).filter((id) => heroes.some((hero) => hero.id === id)).join(',');
  const picksFor = (team: string) => [
    ...new Set(
      [...livePicks, ...liveHovers]
        .filter((pick) => pick.team === team && heroes.some((hero) => hero.id === pick.heroId))
        .map((pick) => pick.heroId),
    ),
  ];
  const confirmedIds = livePicks
    .map((pick) => pick.heroId)
    .sort((a, b) => a - b)
    .join(',');
  const radiantIds = picksFor('radiant').join(',');
  const direIds = picksFor('dire').join(',');
  const idsOf = (team: 'radiant' | 'dire') => {
    const list = team === 'radiant' ? radiantIds : direIds;
    return list ? list.split(',').map(Number) : [];
  };
  const pickedIds = [...new Set([...picksFor('radiant'), ...picksFor('dire')])].sort((a, b) => a - b).join(',');
  // Hero statistics for the match's rank bracket. An automatic choice is kept for the match
  // once it rests on ranks, so profiles loading mid-draft do not refetch every table.
  const bracketSetting = useRankBracket();
  const matchTiers = players.map(
    (player) => player.rankTier ?? (player.accountId ? entries[player.accountId]?.result?.profile.rank_tier : null),
  );
  const chosen = chooseBracket(bracketSetting, { matchTiers, ownTier, ownMmr });
  // The journal keeps the median medal of an own match, so its profile row has a bracket
  // before STRATZ ranks the match.
  const medal = live.mode === 'player' ? matchMedalTier(matchTiers) : undefined;
  useEffect(() => {
    if (match && medal) void api.setMedalRank?.(match, medal).catch(() => {});
  }, [match, medal]);
  const bracketFor = useRef<{ key: string; choice: BracketChoice }>(undefined);
  const bracketKey = `${match}-${bracketSetting}`;
  if (bracketFor.current?.key !== bracketKey || bracketFor.current.choice.source === 'none')
    bracketFor.current = { key: bracketKey, choice: chosen };
  const bracket = bracketFor.current.choice.bracket;
  const draftScope = `${match}-${providerRevision}-${bracket}`;
  draftScopeRef.current = draftScope;
  // A late reply (warm-up or request) from another match or provider is dropped.
  const addDraft = (scope: string, ids: number[], reply: DraftData) =>
    setDraftStore((previous) => (scope === draftScopeRef.current ? mergeDraft(previous, scope, ids, reply) : previous));
  const missingIds = missingDraftIds(draftStore, draftScope, pickedIds ? pickedIds.split(',').map(Number) : []);
  // Only heroes this match has not asked for yet are requested; until they arrive the
  // panels keep the match's data. Another match, provider or a failed request hides it.
  const draftNeeded =
    draftStore?.scope !== draftScope || missingIds.length > 0 ? `${draftScope}-${missingIds.join(',')}` : '';
  const draftData =
    connected && stratzDraft && draftStore?.scope === draftScope && !draftError ? draftStore.data : undefined;
  useEffect(() => {
    let active = true;
    setDraftError('');
    setDraftBusy(false);
    if (!connected || stratzDraft === undefined || !draftNeeded) return;
    setDraftBusy(true);
    const scope = draftScope;
    const timer = window.setTimeout(() => {
      if (stratzDraft && api.getDraftData) {
        // Keep the service's ten-ID request limit; an empty request still brings positions.
        const batches = missingIds.length ? draftWarmBatches(missingIds.map((id) => ({ id }))) : [[]];
        void Promise.all(
          batches.map((batch) => api.getDraftData!(batch, bracket).then((reply) => addDraft(scope, batch, reply))),
        )
          .catch((error) => {
            if (active) setDraftError(errorMessage(error));
          })
          .finally(() => {
            if (active) setDraftBusy(false);
          });
      } else setDraftBusy(false);
    }, 100);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [draftNeeded, connected, revision, stratzDraft]);
  // Once per match, from loading on, every hero's matchups are fetched into the store (about
  // 13 requests, cached by the service for an hour): later hovers and picks need none.
  const warmedMatch = useRef('');
  const drafting = [
    'DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD',
    'DOTA_GAMERULES_STATE_HERO_SELECTION',
    'DOTA_GAMERULES_STATE_STRATEGY_TIME',
  ].includes(phase ?? '');
  useEffect(() => {
    if (!match || !drafting || !connected || !stratzDraft || !api.getDraftData || !heroes.length) return;
    if (warmedMatch.current === draftScope) return;
    warmedMatch.current = draftScope;
    const scope = draftScope;
    void (async () => {
      for (const batch of draftWarmBatches(heroes)) {
        if (warmedMatch.current !== scope) return;
        try {
          addDraft(scope, batch, await api.getDraftData!(batch, bracket));
        } catch {
          // A quota or network error ends the warm-up; regular requests still run.
          return;
        }
      }
    })();
  }, [draftScope, match, drafting, connected, stratzDraft, heroes]);
  // Both sides are scored locally from the same draft data; switching panels never refetches.
  const recommendations = useMemo(() => {
    if (!draftData || !pickedIds) return undefined;
    const confirmed = confirmedIds ? confirmedIds.split(',').map(Number) : [];
    const bans = banIds ? banIds.split(',').map(Number) : [];
    const score = (team: 'radiant' | 'dire') =>
      scorePositions(
        heroes,
        draftData,
        idsOf(team),
        idsOf(team === 'radiant' ? 'dire' : 'radiant'),
        bans,
        synergyWeight,
        confirmed,
      );
    return { radiant: score('radiant'), dire: score('dire') };
  }, [draftData, heroes, radiantIds, direIds, pickedIds, confirmedIds, banIds, synergyWeight]);
  // Counters against a side's heroes, for the other side to pick.
  const counters = useMemo(() => {
    const confirmed = confirmedIds ? confirmedIds.split(',').map(Number) : [];
    const bans = banIds ? banIds.split(',').map(Number) : [];
    return {
      radiant: counterPicks(heroes, draftData, idsOf('radiant'), confirmed, bans),
      dire: counterPicks(heroes, draftData, idsOf('dire'), confirmed, bans),
    };
  }, [heroes, draftData, radiantIds, direIds, confirmedIds, banIds]);
  const meta = useMemo(
    () =>
      metaPicks(
        heroes,
        draftData,
        confirmedIds ? confirmedIds.split(',').map(Number) : [],
        banIds ? banIds.split(',').map(Number) : [],
      ),
    [heroes, draftData, confirmedIds, banIds],
  );
  const adviceMessage = !connected
    ? 'Waiting for match data'
    : draftError ||
      (!stratzDraft
        ? 'Connect STRATZ for draft statistics'
        : (draftBusy || pickedIds) && !draftData
          ? 'Loading…'
          : undefined);
  const nameOf = (id: number) => heroes.find((hero) => hero.id === id)?.localized_name ?? `#${id}`;
  const matchSummaries = ids.split(',').flatMap((id) => (entries[id]?.result ? [entries[id].result!] : []));
  const median = medianMatches(matchSummaries);
  const smurfs = new Set(
    matchSummaries.filter((player) => isSmurf(player, ownAccountId, median)).map((player) => player.accountId),
  );
  const loaded = Object.values(entries).filter((entry) => entry.result).length;
  const privateProfiles = Object.values(entries).filter((entry) => entry.result?.isPublic === false).length;
  const updating = Object.values(entries).some((entry) => entry.loading);
  const obsolete = Object.values(entries).some(
    (entry) => entry.result && (entry.result.days !== days || entry.filterKey !== filterKey),
  );
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
        picked={livePicks.length}
        hovered={liveHovers.length}
        partial={connected && livePicks.length < 10}
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
  // One role per player across the team, from period history and the hero's positions.
  const rolesFor = (team: 'radiant' | 'dire') =>
    guessTeamRoles(
      draftSlots[team].map((draftRow) => {
        const player = anonymousDraft ? undefined : draftSlotPlayer(live, team, draftRow, draftSlots);
        const data = player?.accountId ? entries[player.accountId]?.result : undefined;
        const games = data?.historyUnavailable ? 0 : (data?.heroes.reduce((sum, hero) => sum + hero.games, 0) ?? 0);
        return {
          heroId:
            draftRow.pick ??
            (draftRow.hoverBanned ? undefined : draftRow.hover) ??
            (player ? heroOf(player)?.id : undefined),
          matches: games > 0 ? data?.matches : undefined,
          lanes: draftRow.lanes,
        };
      }),
      draftData?.positions ?? [],
    );
  const teamRoles = { radiant: rolesFor('radiant'), dire: rolesFor('dire') };
  // Heroes of a team at their role for the lane page; a hover counts as tentative.
  const laneHeroes = (team: 'radiant' | 'dire'): LaneHero[] =>
    draftSlots[team].flatMap((draftRow, index) => {
      const role = teamRoles[team][index];
      const player = anonymousDraft ? undefined : draftSlotPlayer(live, team, draftRow, draftSlots);
      const heroId =
        draftRow.pick ??
        (draftRow.hoverBanned ? undefined : draftRow.hover) ??
        (player ? heroOf(player)?.id : undefined);
      if (!role || heroId === undefined) return [];
      return [
        {
          heroId,
          position: role.position,
          guessed: role.guessed,
          hovered: draftRow.pick === undefined && draftRow.hover === heroId,
        },
      ];
    });
  // Order: matchups → lanes → own side → other side → meta → counters. A player only
  // needs counters to the enemy; a spectator gets both sides.
  const analysisPages: AnalysisPage[] = [
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
      body: (
        <LaneSummaryPanel
          summary={laneSummary(laneHeroes('radiant'), laneHeroes('dire'), draftData, synergyWeight)}
          heroes={heroes}
          weight={synergyWeight}
          note={draftDataNote(draftData)}
        />
      ),
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
  return (
    <section className="match-screen" aria-label="Match and draft">
      <div className="match-toolbar">
        <div>
          <span
            className={`dot ${connectedInput && !lingering ? 'online' : continuity.suspended ? 'reconnecting' : ''}`}
          />
          <strong
            title={
              lingering ? 'You left this match. Its roster stays until you play or spectate another one.' : undefined
            }
          >
            {lingering
              ? live.mode === 'spectator'
                ? 'Last spectated match'
                : 'Last match'
              : (phaseNames[phase ?? ''] ?? (connected ? 'Game data' : 'Waiting for a match'))}
          </strong>
          <span className="match-id">{match && match !== '0' ? `#${match}` : 'DOTA 2'}</span>
          {lingering && (
            <button className="link-button" onClick={() => setReleased(live.matchId)}>
              Clear
            </button>
          )}
        </div>
        {/* Roster status and period live here, not in a caption row: every row of height
            counts for keeping the ten players and the analysis panels on screen together. */}
        <div>
          <span className="roster-status">
            {anonymousDraft
              ? 'Anonymous draft'
              : `Profiles · ${loaded}/${ids ? ids.split(',').length : 0} loaded${privateProfiles ? ` · ${privateProfiles} private` : ''}`}
          </span>
          {updating && <small role="status">Updating…</small>}
          <select
            aria-label="Statistics period"
            value={days}
            onChange={(event) => {
              const value = Number(event.target.value) as StatsDays;
              localStorage.setItem('stats-days', String(value));
              setDays(value);
            }}
          >
            {[7, 14, 30, 90].map((value) => (
              <option key={value} value={value}>
                {value} days
              </option>
            ))}
          </select>
          {live.mode === 'spectator' && <span className="badge">SPECTATOR</span>}
          <b className="mono">{live.clock == null || continuity.frozen ? '—:—' : formatDuration(live.clock)}</b>
          <button
            className="icon-button"
            aria-label="Refresh match statistics"
            disabled={!connected}
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>
      {connected && (live.rosterStatus === 'permission' || live.draftStatus === 'permission') && (
        <div className="notice error" role="alert">
          The system denied access to Dota memory. Roster and picks from memory are unavailable; showing GSI data only.
        </div>
      )}
      {!connected ? (
        <div className="match-status" role="status">
          <div>
            <b>
              {live.status === 'error'
                ? 'Connection error'
                : live.receivedAt
                  ? 'Stale data · connection to the game interrupted'
                  : 'Waiting for data from Dota 2'}
            </b>
            <p>
              {live.error ??
                connectionHint(steamSetup) ??
                'The roster and picks will appear when the game sends them. Install the GSI configuration, add -gamestateintegration, and restart Dota 2 to connect.'}
            </p>
          </div>
          <button className={steamSetup?.state === 'repair' ? 'primary' : 'secondary'} onClick={setup}>
            <Settings size={15} />
            {steamSetup?.state === 'repair' ? 'Fix connection' : 'Connection'}
          </button>
        </div>
      ) : !anonymousDraft && players.length < 10 ? (
        <div className="match-status">
          <div>
            <b>
              {partialPlayerRoster
                ? `Players available: ${players.length}/10${live.rosterStatus === 'disabled' ? (showReaderNotice(platform, live, connected) ? '' : ` · ${rosterMessages.disabled}`) : ` · ${live.gameState === 'DOTA_GAMERULES_STATE_HERO_SELECTION' ? `picks: ${livePicks.length} · profiles after hero selection` : ((live.rosterStatus && rosterMessages[live.rosterStatus]) ?? 'waiting for match roster')}`}`
                : `The game provided ${players.length} of 10 players`}
            </b>
            {!partialPlayerRoster && (
              <p>Waiting for the remaining slots. Statistics load when public IDs become available.</p>
            )}
          </div>
        </div>
      ) : null}
      {continuity.suspended && (
        <div className="match-status reconnect-notice" role="status">
          <div>
            <b>Connection to match #{match} interrupted · waiting to reconnect</b>
            <p>
              The roster, draft, and statistics are preserved. Updates will resume when you return to this match; the
              match ends when the post-game screen is detected.
            </p>
          </div>
          <button className="secondary" onClick={() => setReleased(live.matchId)}>
            Reset match
          </button>
        </div>
      )}
      {showReaderNotice(platform, live, connected) && (
        <div className="match-status reader-notice" role="status">
          <div>
            <b>The enemy roster, picks, and bans require memory reading</b>
            <details>
              <summary>What to know about the risk</summary>
              <p>{platform === 'win32' ? readerRiskWindows : readerRisk}</p>
            </details>
          </div>
          <button className="secondary" onClick={setup}>
            <Settings size={15} />
            Enable in Settings
          </button>
        </div>
      )}
      <div className="match-workspace">
        <div className="match-roster">
          <h1 className="sr-only">Match players</h1>
          {Object.values(entries).some((entry) => entry.error) && (
            <div className="notice error" role="alert">
              {Object.values(entries).find((entry) => entry.error)?.error}
            </div>
          )}
          <>
            {obsolete && (
              <p className="table-refresh-note">
                {updating ? 'Updating sample.' : 'Could not update the entire sample.'} Previous data is marked in the
                rows.
              </p>
            )}
          </>
          <div className="table-scroll">
            <table
              className={`match-table ${display.rank ? '' : 'hide-rank'} ${display.totals ? '' : 'hide-totals'} ${display.frequent ? '' : 'hide-frequent'}`}
            >
              <colgroup>
                <col style={{ width: '22%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '7%' }} />
              </colgroup>
              <thead>
                <tr className="column-groups">
                  <th colSpan={1 + Number(display.rank) + Number(display.totals)}>Player · all time</th>
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
                return (
                  <tbody key={team} className={`team-${team}`}>
                    <tr className="team-divider">
                      <td colSpan={6 + Number(display.rank) + Number(display.totals) + Number(display.frequent)}>
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
                      const hero =
                        heroes.find((hero) => hero.id === draftHeroId) ?? (player ? heroOf(player) : undefined);
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
                      const name =
                        player?.name || data?.profile.profile?.personaname || (player ? 'Name not provided' : '—');
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
                          <td>
                            <div className="match-player">
                              <span className="player-slot">{index + 1}</span>
                              <Avatar
                                url={data?.profile.profile?.avatarfull}
                                frame={slotColour(team, draftRow, player)}
                              />
                              <div>
                                <span className="player-name">
                                  <CountryFlag
                                    code={data?.profile.profile?.loccountrycode}
                                    source={data?.source}
                                    id={data && player?.accountId}
                                  />
                                  <button
                                    className="player-link"
                                    disabled={!player?.accountId}
                                    onClick={() => player?.accountId && setSelected(player.accountId)}
                                    {...(player?.accountId
                                      ? tip(
                                          <PlayerPreview
                                            accountId={player.accountId}
                                            name={name}
                                            noteName={player.name || data?.profile.profile?.personaname || ''}
                                            summary={data}
                                            note={note}
                                            met={met}
                                            heroes={heroes}
                                            onOpen={() => {
                                              hide();
                                              setSelected(player.accountId);
                                            }}
                                            onMatch={(id) =>
                                              void api.openMatchSite?.(String(id), 'stratz').catch(() => {})
                                            }
                                          />,
                                          true,
                                        )
                                      : {})}
                                  >
                                    {name}
                                  </button>
                                  {isSelf && <span className="self-badge">YOU</span>}
                                  {player?.accountId && smurfs.has(player.accountId) && (
                                    <span className="smurf-badge" title={smurfExplanation} tabIndex={0}>
                                      SMURF
                                    </span>
                                  )}
                                  <MetBadge met={met} heroes={heroes} />
                                  {note && (
                                    <span title={note.text} className="note-marker">
                                      <BookOpen size={12} />
                                    </span>
                                  )}
                                </span>
                                <DraftRowLanes row={draftRow} />
                                <PlayerLinks id={player?.accountId} />
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
                              <MatchRole role={roles[index]} heroName={hero?.localized_name} days={days} />
                            </div>
                          </td>
                          <td className="rank-cell">
                            {data ? (
                              <RankMedal tier={data?.profile.rank_tier} leaderboard={data?.profile.leaderboard_rank} />
                            ) : (
                              '—'
                            )}
                          </td>
                          <td
                            className="all-time"
                            title={entry?.totalsError ?? `Overall statistics ${data?.source ?? ''}`}
                          >
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
                          <td title={entry?.error}>
                            {period && data && periodGames === 0 && data.limited ? (
                              <span
                                className="muted"
                                title="History is incomplete: matching games may be further back."
                              >
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
        <div className={`analysis-strip${wide ? ' three' : ''}`} ref={strip}>
          {/* A new match resets both panels to their starting pages. */}
          <AnalysisCarousel
            key={`left-${match}`}
            label="Left panel"
            pages={analysisPages}
            initial={0}
            panel="left"
            active={active}
            lane={lane}
            setLane={setLane}
          />
          <AnalysisCarousel
            key={`right-${match}`}
            label="Right panel"
            pages={analysisPages}
            initial={analysisPages.findIndex((page) => page.id === `suggest-${ownSide}`)}
            panel="right"
            active={active}
            lane={lane}
            setLane={setLane}
          />
          {wide && (
            <AnalysisCarousel
              key={`third-${match}`}
              label="Third panel"
              pages={analysisPages}
              initial={Math.max(
                0,
                analysisPages.findIndex((page) => page.id === 'meta'),
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
          close={() => setSelected(undefined)}
        />
      )}
    </section>
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

function DraftRowLanes({ row }: { row: VisibleDraftSlot }) {
  if (!row.lanes.length) return null;
  const label = `Lane selected in the draft: ${row.lanes.map((position) => rankedRoles.find((role) => role.id === position)?.name ?? position).join(', ')}`;
  return (
    <span className="draft-lane-flags" title={label} aria-label={label}>
      {row.lanes.map((position) => (
        <RoleIcon key={position} position={position} />
      ))}
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
          <div>
            <span className="player-name muted">{row.isSelf ? 'You' : `Player ${row.teamSlot + 1}`}</span>
            <DraftRowLanes row={row} />
          </div>
          <MatchRole role={role} heroName={hero?.localized_name} />
        </div>
      </td>
      <td className="rank-cell">—</td>
      <td className="all-time">—</td>
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
