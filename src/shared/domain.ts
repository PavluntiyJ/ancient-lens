import { z } from 'zod';
import type { DraftData } from './draft';
import type { RankBracket } from './rank-bracket';

const steamBase = 76561197960265728n;
export function accountId(input: string): string {
  let value = input.trim();
  if (value.startsWith('https://steamcommunity.com/profiles/')) {
    const url = new URL(value);
    value = url.pathname.split('/')[2] ?? '';
  }
  if (!/^\d{1,20}$/.test(value))
    throw new Error('Enter a numeric Dota ID, SteamID64, or steamcommunity.com/profiles/… URL');
  let id = BigInt(value);
  if (id >= steamBase) id -= steamBase;
  if (id < 1n || id > 4294967295n) throw new Error('Dota ID must be between 1 and 4294967295.');
  return id.toString();
}

export const noteSchema = z.object({
  accountId: z.string().transform(accountId),
  name: z.string().trim().max(80),
  text: z.string().trim().min(1, 'Write a note.').max(2000),
  tag: z.enum(['neutral', 'teammate', 'avoid']),
});
export type NoteInput = z.input<typeof noteSchema>;
export type Note = z.output<typeof noteSchema> & { updatedAt: string };
export const mmrInputSchema = z.object({ value: z.number().int().min(0).max(20000) });
export type MmrEntry = {
  id: string;
  value: number;
  createdAt: string;
  accountId?: string;
  source?: 'manual' | 'dota-memory';
  confidence?: number;
};
export type OwnAccount = {
  accountId: string | null;
  status: string;
  source: string;
  observedAt: string;
  mmr: number | null;
  confidence: number | null;
  behaviorScore: number | null;
  communicationScore: number | null;
};
/** Last confirmed reading for the current account, shown while Dota is closed. */
export type RatingSnapshot = {
  mmr: number | null;
  confidence: number;
  behaviorScore: number;
  communicationScore: number;
  confirmedAt: string;
};
export type LocalState = {
  revision?: number;
  ownAccount?: OwnAccount | null;
  ratingSnapshot?: RatingSnapshot | null;
  unassignedMmrCount?: number;
  nativeRosterReader?: 'off' | 'on';
  closeToTray?: boolean;
  /** Stored key bindings; absent in an older state update. */
  shortcuts?: import('./shortcuts').Shortcuts;
  /** Matches of the current account in the local match journal. */
  recordedMatches?: number;
  /** Changes whenever the match journal does (new match, rating, match details). */
  journalRevision?: number;
  accountId: string;
  notes: Note[];
  mmr: MmrEntry[];
};
export function newerLocalState(current: LocalState, incoming: LocalState): LocalState {
  return (incoming.revision ?? 0) < (current.revision ?? 0) ? current : incoming;
}
/** Live rating only; sent instead of the full state when stored data did not change. */
export type OwnUpdate = { revision: number; ownAccount: OwnAccount | null };
export function applyStateUpdate(current: LocalState, incoming: LocalState | OwnUpdate): LocalState {
  if ('notes' in incoming) return newerLocalState(current, incoming);
  return incoming.revision < (current.revision ?? 0)
    ? current
    : { ...current, revision: incoming.revision, ownAccount: incoming.ownAccount };
}

export const heroSchema = z.object({
  id: z.number().int(),
  name: z.string().optional(),
  localized_name: z.string(),
  primary_attr: z.string(),
  attack_type: z.string(),
  roles: z.array(z.string()),
});
export const profileSchema = z.object({
  rank_tier: z.number().nullable().optional(),
  leaderboard_rank: z.number().nullable().optional(),
  profile: z
    .object({
      account_id: z.number(),
      personaname: z.string().nullable().optional(),
      avatarfull: z.string().optional(),
      /** Steam profile location, ISO 3166-1 alpha-2; absent when the player set none. */
      loccountrycode: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});
/** Another public account in a match: hero and K/D/A when the source knew them. */
export const participantSchema = z.object({
  id: z.number(),
  name: z.string().optional(),
  hero: z.number().optional(),
  kills: z.number().optional(),
  deaths: z.number().optional(),
  assists: z.number().optional(),
});
export type Participant = z.infer<typeof participantSchema>;
/** One of the ten players of a match (STRATZ history): absent numbers stay unknown. */
export const lineupEntrySchema = z.object({
  radiant: z.boolean(),
  /** The profile's own player. */
  own: z.boolean().optional(),
  /** Public accounts only; anonymous players keep their hero and numbers. */
  id: z.number().optional(),
  name: z.string().optional(),
  hero_id: z.number().optional(),
  kills: z.number().optional(),
  deaths: z.number().optional(),
  assists: z.number().optional(),
  gold_per_min: z.number().optional(),
  xp_per_min: z.number().optional(),
  last_hits: z.number().optional(),
  denies: z.number().optional(),
  net_worth: z.number().optional(),
  hero_damage: z.number().optional(),
  tower_damage: z.number().optional(),
  hero_healing: z.number().optional(),
  imp: z.number().optional(),
  position: z.string().optional(),
});
export type LineupEntry = z.infer<typeof lineupEntrySchema>;
export const matchSchema = z.object({
  match_id: z.number(),
  hero_id: z.number(),
  start_time: z.number(),
  duration: z.number(),
  player_slot: z.number(),
  radiant_win: z.boolean().nullable().optional(),
  kills: z.number().nullable().optional(),
  deaths: z.number().nullable().optional(),
  assists: z.number().nullable().optional(),
  gold_per_min: z.number().nullable().optional(),
  xp_per_min: z.number().nullable().optional(),
  position: z.string().nullable().optional(),
  /** Single queued role from the Linux draft; provider position/role takes precedence. */
  queue_position: z.number().int().min(1).max(5).nullable().optional(),
  lane_role: z.number().nullable().optional(),
  role: z.string().nullable().optional(),
  game_mode: z.number().optional(),
  lobby_type: z.number().optional(),
  // STRATZ personal history only; absent values stay unknown rather than zero.
  last_hits: z.number().nullable().optional(),
  denies: z.number().nullable().optional(),
  net_worth: z.number().nullable().optional(),
  hero_damage: z.number().nullable().optional(),
  tower_damage: z.number().nullable().optional(),
  hero_healing: z.number().nullable().optional(),
  imp: z.number().nullable().optional(),
  /** STRATZ rank tier of the match (10–80), about the average of its players; 50 is Legend without stars. */
  average_rank: z.number().int().min(10).max(80).optional(),
  /** Median medal (10–80) of the players the live match showed, kept by the match journal. */
  medal_rank: z.number().int().min(10).max(80).optional(),
  /** Kills and deaths of the own team (all five players), for kill/death participation. */
  team_kills: z.number().nullable().optional(),
  team_deaths: z.number().nullable().optional(),
  /** Team scores from the game (match journal). */
  radiant_score: z.number().nullable().optional(),
  dire_score: z.number().nullable().optional(),
  // Ancient Lens match journal: recorded from the game while the app ran.
  recorded: z.boolean().optional(),
  /** Only the journal has this match (private match data, or not yet indexed). */
  local_only: z.boolean().optional(),
  /** Providers that completed a recorded match from its match ID. */
  details: z.array(z.enum(['STRATZ', 'OpenDota'])).optional(),
  /** Rating after the match and its change, read from the game around this recorded match. */
  mmr_after: z.number().optional(),
  mmr_delta: z.number().optional(),
  /** Other public accounts on the own team and the enemy team (STRATZ history, journal). */
  allies: z.array(participantSchema).optional(),
  enemies: z.array(participantSchema).optional(),
  /** All players with their statistics (STRATZ history); absent for older cache and other sources. */
  lineup: z.array(lineupEntrySchema).max(10).optional(),
});
export const playerHeroSchema = z.object({ hero_id: z.number(), games: z.number(), win: z.number() });
export const snapshotSchema = z.object({
  accountId: z.string(),
  fetchedAt: z.string(),
  profile: profileSchema,
  wl: z.object({ win: z.number(), lose: z.number() }),
  matches: z.array(matchSchema),
  playerHeroes: z.array(playerHeroSchema),
  heroes: z.array(heroSchema),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export type PlayerResult = { snapshot: Snapshot; stale: boolean; warning?: string };
export type PlayerHistory = {
  accountId: string;
  source: 'STRATZ' | 'OpenDota';
  fetchedAt: string;
  profile: z.infer<typeof profileSchema>;
  matches: Match[];
  hasMore: boolean;
  nextOffset: number;
  stale: boolean;
  historyUnavailable?: boolean;
  /** The provider returned only a recent sample (OpenDota) with no way to page further. */
  limited?: boolean;
  warning?: string | null;
  /** Matches of this account in the local match journal, merged into `matches`. */
  recordedCount?: number;
};
export type Match = z.infer<typeof matchSchema>;
export function matchWon(match: Pick<Match, 'radiant_win' | 'player_slot'>): boolean | null {
  return typeof match.radiant_win === 'boolean' ? match.player_slot < 128 === match.radiant_win : null;
}
export function rankName(tier: number | null | undefined): string {
  if (!tier) return 'Rank not available';
  const medal = Math.floor(tier / 10);
  const labels = ['', 'Herald', 'Guardian', 'Crusader', 'Archon', 'Legend', 'Ancient', 'Divine', 'Immortal'];
  return labels[medal] ? `${labels[medal]}${medal < 8 && tier % 10 ? ` ${tier % 10}` : ''}` : 'Rank not available';
}
export function formatDecimal(value: number, digits = 1): string {
  return String(Number(value.toFixed(digits)));
}
export function formatDuration(seconds: number): string {
  return `${seconds < 0 ? '−' : ''}${Math.floor(Math.abs(seconds) / 60)}:${String(Math.floor(Math.abs(seconds) % 60)).padStart(2, '0')}`;
}
export type TeamSlot = 0 | 1 | 2 | 3 | 4;
export type LivePlayer = {
  key: string;
  team: 'radiant' | 'dire';
  teamSlot?: TeamSlot;
  name?: string;
  hero?: string;
  accountId?: string;
  heroId?: number;
  /** Medal read from Linux player data (10–80); absent for uncalibrated or unknown. */
  rankTier?: number;
  heroName?: string;
  kills?: number;
  deaths?: number;
  assists?: number;
  lastHits?: number;
  denies?: number;
  gold?: number;
  health?: number;
  maxHealth?: number;
  mana?: number;
  maxMana?: number;
  level?: number;
};
export type LiveDraft = {
  matchId: string;
  gameState: string;
  source: 'native';
  observedAt: number;
  slots?: { slot: number; team: 'radiant' | 'dire'; teamSlot: TeamSlot | -1 }[];
  picks: { slot: number; team: 'radiant' | 'dire'; heroId: number }[];
  hovers?: { slot: number; team: 'radiant' | 'dire'; heroId: number }[];
  lanes?: { slot: number; team: 'radiant' | 'dire'; flags: number }[];
  /** All Pick/Turbo bans from native memory; no team is known. */
  bans?: number[];
};
/** Every status the native reader publishes (roster.rs, roster/picks.rs, roster/source2.rs errors). */
export const readerStatuses = [
  'disabled',
  'waiting',
  'ready',
  'test-mode',
  'permission',
  'unsupported',
  'not-running',
  'multiple-games',
  'waiting-entities',
  'match-mismatch',
  'incomplete',
  'unavailable',
  'retrying',
] as const;
export type ReaderStatus = (typeof readerStatuses)[number];
const isReaderStatus = (value: unknown): value is ReaderStatus =>
  (readerStatuses as readonly unknown[]).includes(value);
/** The live state crosses the IPC boundary as untyped JSON: an unknown reader
 * status (e.g. a newer backend) becomes 'unavailable' instead of an arbitrary string. */
export function normalizeLive(state: LiveState): LiveState {
  const next = { ...state };
  for (const key of ['rosterStatus', 'draftStatus'] as const) {
    if (next[key] !== undefined && !isReaderStatus(next[key])) next[key] = 'unavailable';
  }
  if (next.selfTeamSlot !== undefined && ![0, 1, 2, 3, 4].includes(next.selfTeamSlot)) delete next.selfTeamSlot;
  return next;
}
export type LiveState = {
  receivedAt: number | null;
  status: 'waiting' | 'connected' | 'error';
  error?: string;
  matchId?: string;
  gameState?: string;
  clock?: number;
  hero?: string;
  kills?: number;
  deaths?: number;
  assists?: number;
  lastHits?: number;
  denies?: number;
  gold?: number;
  health?: number;
  maxHealth?: number;
  mana?: number;
  maxMana?: number;
  level?: number;
  mode?: 'player' | 'spectator';
  players?: LivePlayer[];
  selfTeamSlot?: TeamSlot;
  rosterSource?: 'native';
  rosterStatus?: ReaderStatus;
  draft?: LiveDraft;
  draftStatus?: ReaderStatus;
};
export type AppInfo = {
  runtime?: string;
  version: string;
  platform: string;
  wayland: boolean;
  shortcut: boolean;
  /** The stored global combination (Windows binds it; Linux shows the portal trigger). */
  shortcutKey?: string;
  /** The desktop portal's description of the bound shortcut (Linux); absent for the fixed key. */
  shortcutTrigger?: string | null;
  tray?: boolean;
  dataPath: string;
  gsiPort: number;
};
export type Hero = z.infer<typeof heroSchema>;
export const matchupSchema = z.object({
  hero_id: z.number().int(),
  games_played: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
});
export type Matchup = z.infer<typeof matchupSchema>;
export const draftInputSchema = z
  .object({
    allies: z.array(z.number().int().positive()).max(5),
    enemies: z.array(z.number().int().positive()).min(1).max(5),
    bans: z.array(z.number().int().positive()).max(30),
    role: z.string().max(30),
  })
  .refine((value) => {
    const all = [...value.allies, ...value.enemies, ...value.bans];
    return new Set(all).size === all.length;
  }, 'Heroes must not be repeated.');
export type DraftInput = z.infer<typeof draftInputSchema>;
export type Suggestion = { hero: Hero; score: number; games: number; coverage: number };
export type DraftResult = { suggestions: Suggestion[]; fetchedAt: string };
export type MatchupRow = { heroId: number; opponents: Matchup[] };
export const periodStatsSchema = z.object({
  accountId: z.string(),
  fetchedAt: z.string(),
  heroes: z.array(playerHeroSchema),
});
export type PeriodStats = z.infer<typeof periodStatsSchema>;
export const statsDaysSchema = z.union([z.literal(7), z.literal(14), z.literal(30), z.literal(90)]);
export type StatsDays = z.infer<typeof statsDaysSchema>;
export type PlayerSummary = {
  accountId: string;
  fetchedAt: string;
  source: 'OpenDota' | 'STRATZ';
  days: StatsDays;
  isPublic?: boolean;
  /** End of the newest visible match in Unix seconds, regardless of the period (STRATZ only). */
  lastMatchAt?: number | null;
  profile: z.infer<typeof profileSchema>;
  total?: { games: number; wins: number };
  matches: Match[];
  heroes: z.infer<typeof playerHeroSchema>[];
  limited: boolean;
  stale: boolean;
  warning?: string;
  historyUnavailable?: boolean;
};
export type StatsFilter = { mode: 'normal' | 'turbo' | 'ability' | 'all'; rankedOnly: boolean };
export function winRateClass(wins: number, games: number): string {
  if (!games) return 'neutral';
  const percent = Math.round((wins / games) * 100);
  return percent > 50 ? 'positive' : percent < 50 ? 'negative' : 'neutral';
}
// Lifetime totals use four tones (vivid only from 50 matches and a 10-point gap);
// period rows use moderate tones from 3 matches.
export type WinRateTone = 'positive' | 'negative' | 'positive moderate' | 'negative moderate' | 'neutral';
export function winRateTone(wins: number, games: number, lifetime = false): WinRateTone {
  if (!Number.isFinite(wins) || !Number.isFinite(games) || games <= 0 || wins < 0 || wins > games) return 'neutral';
  const rate = (wins / games) * 100;
  const side = rate > 50 ? 'positive' : 'negative';
  if (lifetime && games >= 50 && Math.abs(50 - rate) >= 10) return side;
  return games >= (lifetime ? 50 : 3) && Math.abs(50 - rate) >= (lifetime ? 5 : 3) ? `${side} moderate` : 'neutral';
}
export type ProviderInfo = {
  source: 'OpenDota' | 'STRATZ';
  hasToken: boolean;
  persistent: boolean;
  automatic?: boolean;
  serviceConfigured?: boolean;
  status?: string;
};
export function summarizeHeroes(matches: Match[]) {
  const rows = new Map<number, { hero_id: number; games: number; win: number }>();
  for (const match of matches) {
    const won = matchWon(match);
    if (won === null) continue;
    const row = rows.get(match.hero_id) ?? { hero_id: match.hero_id, games: 0, win: 0 };
    row.games++;
    row.win += Number(won);
    rows.set(row.hero_id, row);
  }
  return [...rows.values()].sort((a, b) => b.games - a.games);
}
export function scoreDraft(heroes: Hero[], matchups: Matchup[][], input: DraftInput): Suggestion[] {
  const excluded = new Set([...input.allies, ...input.enemies, ...input.bans]);
  return heroes
    .filter((hero) => !excluded.has(hero.id) && (!input.role || hero.roles.includes(input.role)))
    .flatMap((hero) => {
      const rows = matchups
        .map((rows) => rows.find((row) => row.hero_id === hero.id))
        .filter((row): row is Matchup => !!row && row.games_played >= 30 && row.wins <= row.games_played);
      if (!rows.length) return [];
      // API rows are from the enemy's perspective. Invert their wins and shrink
      // each pair toward 50% with 100 prior games. This is NOT a victory forecast.
      const score =
        (rows.reduce((sum, row) => sum + (row.games_played - row.wins + 50) / (row.games_played + 100), 0) /
          rows.length) *
        100;
      return [{ hero, score, games: rows.reduce((sum, row) => sum + row.games_played, 0), coverage: rows.length }];
    })
    .sort((a, b) => b.coverage - a.coverage || b.score - a.score || b.games - a.games);
}
export type WindowEdge = 'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest';
/** STRATZ per-game averages of one hero on one position, for one match duration (`time`, minutes) or all. */
export type HeroAverageRow = {
  heroId: number;
  position: 1 | 2 | 3 | 4 | 5;
  time: number | null;
  matchCount: number;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  goldPerMinute: number | null;
  xp: number | null;
  cs: number | null;
  heroDamage: number | null;
  networth: number | null;
  /** Kill participation, percent. */
  killContribution: number | null;
};
export type HeroAverages = { source: 'STRATZ'; fetchedAt: string; bracket: RankBracket; rows: HeroAverageRow[] };
export type DesktopApi = {
  resizeWindow?(edge: WindowEdge): Promise<void>;
  windowAction?(action: 'drag' | 'minimize' | 'maximize' | 'close'): Promise<void>;
  /** Minimum window for an interface scale (percent), capped at the monitor's work area. */
  setWindowMinSize?(scale: number): Promise<{ width: number; height: number }>;
  getState(): Promise<LocalState>;
  onState?(callback: (state: LocalState | OwnUpdate) => void): () => void;
  getInfo(): Promise<AppInfo>;
  setAccount(id: string): Promise<LocalState>;
  setNativeRosterReader?(value: 'off' | 'on'): Promise<LocalState>;
  setCloseToTray?(value: boolean): Promise<LocalState>;
  setShortcuts?(value: import('./shortcuts').Shortcuts): Promise<LocalState>;
  getPlayer(id: string): Promise<PlayerResult>;
  /** The median medal of the live match's players, kept with its journal record. */
  setMedalRank?(matchId: string, tier: number): Promise<void>;
  /** `refresh` asks the provider even when the saved history is recent. */
  getHistory(id: string, offset?: number, cachedOnly?: boolean, refresh?: boolean): Promise<PlayerHistory | null>;
  openPlayerSite(id: string, site: import('./player-sites').PlayerSite): Promise<string>;
  openMatchSite?(id: string, site: import('./player-sites').PlayerSite): Promise<string>;
  getHeroes(): Promise<Hero[]>;
  getPatches?(): Promise<import('./history').Patch[]>;
  /** Steam profile country from OpenDota, for profiles whose provider did not send one. */
  getCountry?(id: string): Promise<string | null>;
  getDraft(input: DraftInput): Promise<DraftResult>;
  getMatchups(ids: number[]): Promise<MatchupRow[]>;
  getPeriodStats(id: string, days?: StatsDays): Promise<PeriodStats>;
  getSummary(id: string, days: StatsDays, filter?: StatsFilter): Promise<PlayerSummary>;
  getTotals?(id: string): Promise<{ total?: { games: number; wins: number }; fetchedAt: string }>;
  getDraftData?(ids: number[], bracket?: RankBracket): Promise<DraftData>;
  /** Average statistics of heroes by position and match duration in one rank bracket (STRATZ). */
  getHeroAverages?(ids: number[], bracket: RankBracket): Promise<HeroAverages>;
  getProvider(): Promise<ProviderInfo>;
  setProviderToken(token: string): Promise<ProviderInfo>;
  saveNote(note: NoteInput): Promise<LocalState>;
  deleteNote(id: string): Promise<LocalState>;
  addMmr(value: number, expectedAccountId?: string): Promise<LocalState>;
  deleteMmr(id: string): Promise<LocalState>;
  getLive(): Promise<LiveState>;
  exportGsi(): Promise<string | null>;
  getSteamSetup?(): Promise<import('./steam-setup').SteamSetup>;
  repairSteamSetup?(launch: boolean): Promise<import('./steam-setup').SteamRepair>;
  exportData(): Promise<string | null>;
  toggleWindow(): Promise<boolean>;
  onLive(callback: (state: LiveState) => void): () => void;
};
