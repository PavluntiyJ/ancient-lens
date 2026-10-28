import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Pencil } from 'lucide-react';
import { accountId, matchWon, type Hero, type LocalState, type Match, type PlayerHistory } from '../shared/domain';
import { filterHistory, patchOf, streakRun, type HistoryFilter, type Patch } from '../shared/history';
import { ownProfileRank } from '../shared/own-rank';
import { sortProfileHistory } from '../shared/profile-history';
import { ratingByMatch } from '../shared/rating-history';
import { matchPosition } from '../shared/roles';
import { api, errorMessage, Notice } from './App';
import { ProfileMenu } from './ProfileMenu';
import { useStatsFilter } from './preferences';
import { FilterBar, PositionCards } from './profile/ProfileFilters';
import { MmrChart, ProfileHeader, ScoreCard, type ChartMatch } from './profile/ProfileHeader';
import { HeroesPanel, MatchDetails } from './profile/ProfileSidePanel';
import { ProfileTable } from './profile/ProfileTable';
import { useProfileView } from './profile/profile-view';
import { useHeroAverages } from './profile/useHeroAverages';
import { hide as hideTip } from './Tooltip';
import { MmrPointTip } from './Tips';

const end = (match: Match) => match.start_time + match.duration;

/**
 * My profile: header (identity, rating, small MMR chart, period summary), position cards, one
 * sticky filter bar, and the selected matches in one list beside the Heroes panel or the
 * details of one match. Numbers are coloured against STRATZ bracket averages.
 */
export function OwnProfile({ local, update }: { local: LocalState; update(state: LocalState): void }) {
  const [query, setQuery] = useState(local.accountId);
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState<PlayerHistory | null>(null);
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [patches, setPatches] = useState<Patch[]>();
  const [selectedId, setSelectedId] = useState<number>();
  const [view, change] = useProfileView();
  const settings = useStatsFilter();
  const generation = useRef(0);
  const mounted = useRef(true);
  const loading = useRef(false);

  async function load(offset = 0) {
    if (!local.accountId || loading.current) return;
    loading.current = true;
    const token = ++generation.current;
    setBusy(true);
    setError('');
    try {
      // Asked for by the user: a refresh or a further page, never the saved copy.
      const value = await api.getHistory(local.accountId, offset, false, true);
      if (mounted.current && token === generation.current) setHistory(value);
    } catch (e) {
      if (mounted.current && token === generation.current) setError(errorMessage(e));
    } finally {
      if (mounted.current && token === generation.current) {
        loading.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    const token = ++generation.current;
    loading.current = true;
    setQuery(local.accountId);
    setHistory(null);
    setError('');
    setSelectedId(undefined);
    if (!local.accountId) {
      loading.current = false;
      setBusy(false);
      return;
    }
    setBusy(true);
    let fetched = false;
    void api
      .getHistory(local.accountId, 0, true)
      .then((value) => {
        if (mounted.current && generation.current === token && !fetched && value) setHistory(value);
      })
      .catch(() => {});
    void api
      .getHistory(local.accountId, 0)
      .then((value) => {
        fetched = true;
        if (mounted.current && generation.current === token) setHistory(value);
      })
      .catch((e) => {
        if (mounted.current && generation.current === token) setError(errorMessage(e));
      })
      .finally(() => {
        if (mounted.current && generation.current === token) {
          loading.current = false;
          setBusy(false);
        }
      });
    return () => {
      generation.current++;
      mounted.current = false;
      loading.current = false;
    };
  }, [local.accountId]);
  useEffect(() => {
    let active = true;
    void api
      .getHeroes()
      .then((value) => active && setHeroes(value))
      .catch(() => {});
    void (api.getPatches?.() ?? Promise.resolve([])).catch(() => []).then((rows) => active && setPatches(rows));
    return () => {
      active = false;
    };
  }, []);
  // A match just recorded from the game, or completed from its match data: show it without
  // asking the provider for the history again.
  const journal = `${local.recordedMatches ?? 0}:${local.journalRevision ?? 0}`;
  const seenJournal = useRef(journal);
  useEffect(() => {
    if (journal === seenJournal.current) return;
    seenJournal.current = journal;
    if (!local.accountId || loading.current) return;
    const token = generation.current;
    void api
      .getHistory(local.accountId, 0, true)
      .then((value) => {
        if (mounted.current && token === generation.current && value) setHistory(value);
      })
      .catch(() => {});
  }, [journal]);
  async function connect(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      update(await api.setAccount(accountId(query)));
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const data = history?.accountId === local.accountId ? history : null;
  const loaded = useMemo(() => data?.matches ?? [], [data]);
  const rank = ownProfileRank(local, data?.profile.rank_tier, data?.profile.leaderboard_rank);
  const filter: HistoryFilter = { ...view, patches };
  const filterKey = JSON.stringify(view);
  const matches = useMemo(() => filterHistory(loaded, filter), [loaded, filterKey, patches]);
  const allPositions = useMemo(
    () => (view.position ? filterHistory(loaded, { ...filter, position: 0 }) : matches),
    [loaded, filterKey, patches, matches],
  );
  const ownEntries = useMemo(
    () => local.mmr.filter((entry) => entry.accountId === local.accountId),
    [local.mmr, local.accountId],
  );
  const ratings = useMemo(() => ratingByMatch(loaded, ownEntries), [loaded, ownEntries]);
  const measured = ownEntries.length > 0;
  const heroName = (id: number) => heroes.find((hero) => hero.id === id)?.localized_name ?? `Hero #${id}`;
  const sorted = useMemo(
    () => sortProfileHistory(matches, view.sort, view.direction, heroName, ratings),
    [matches, view.sort, view.direction, heroes, ratings],
  );
  const averages = useHeroAverages(sorted, api.getHeroAverages);
  const selected = selectedId === undefined ? undefined : loaded.find((match) => match.match_id === selectedId);

  // Period summary over the selection.
  const known = [...matches].filter((match) => matchWon(match) !== null).sort((a, b) => end(b) - end(a));
  const wins = known.filter((match) => matchWon(match)).length;
  const deltas = matches.flatMap((match) => ratings.get(match.match_id)?.delta ?? []);
  const imps = matches.flatMap((match) => (typeof match.imp === 'number' ? [match.imp] : []));
  const run = streakRun(loaded, filter);
  const chartMatches: ChartMatch[] = matches
    .flatMap((match) => {
      const rating = ratings.get(match.match_id);
      return rating ? [{ id: match.match_id, at: end(match), value: rating.mmr, win: matchWon(match) }] : [];
    })
    .sort((a, b) => a.at - b.at);
  const patchNames = new Set(loaded.map((match) => patchOf(match, patches)).filter(Boolean));
  const loadedPatches = (patches ?? [])
    .filter((patch) => patchNames.has(patch.name))
    .sort((a, b) => b.name.localeCompare(a.name, 'en', { numeric: true }));
  const select = (match: Match | undefined) => {
    hideTip();
    setSelectedId(match?.match_id === selectedId ? undefined : match?.match_id);
  };

  return (
    <section className="own-profile">
      <h1 className="sr-only">My profile</h1>
      <ProfileHeader
        local={local}
        data={data}
        rank={rank}
        busy={busy}
        onRefresh={() => void load()}
        actions={
          local.accountId && !local.ownAccount?.accountId ? (
            <button
              className="icon-button"
              aria-label="Change ID"
              title="Change ID"
              onClick={() => setEditing((value) => !value)}
            >
              <Pencil size={14} />
            </button>
          ) : undefined
        }
        chart={
          <MmrChart
            points={chartMatches}
            onPoint={(id) => select(loaded.find((match) => match.match_id === id))}
            describe={(id) => {
              const match = loaded.find((row) => row.match_id === id);
              const rating = ratings.get(id);
              return rating && match ? (
                <MmrPointTip
                  point={{ value: rating.mmr, at: end(match), delta: rating.delta, source: 'dota-memory' }}
                  match={match}
                  hero={heroes.find((hero) => hero.id === match.hero_id)}
                />
              ) : null;
            }}
          />
        }
        score={
          <ScoreCard
            label={view.days ? `Last ${view.days} days` : 'All loaded'}
            wins={wins}
            losses={known.length - wins}
            mmrChange={measured && deltas.length ? deltas.reduce((sum, delta) => sum + delta, 0) : undefined}
            averageImp={imps.length ? imps.reduce((sum, imp) => sum + imp, 0) / imps.length : undefined}
            streak={run ? `${run.count} ${run.won ? 'W' : 'L'}` : undefined}
          />
        }
      />
      {(!local.accountId || editing) && (
        <form className="search-panel" onSubmit={(event) => void connect(event)}>
          <label htmlFor="own-account">My Dota ID / SteamID64</label>
          <input
            id="own-account"
            aria-label="My Dota ID"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            required
            maxLength={160}
          />
          <button className="primary">Connect profile</button>
        </form>
      )}
      {error && <Notice error>{error}</Notice>}
      {/* Saved matches speak for themselves; a provider note matters only when nothing shows. */}
      {data?.warning && !loaded.length && <Notice>{data.warning}</Notice>}
      {busy && !data && (
        <p role="status" className="muted">
          Loading my statistics…
        </p>
      )}
      {data && (
        <>
          <PositionCards
            matches={allPositions}
            ratings={ratings}
            view={view}
            change={change}
            heroes={heroes}
            measured={measured}
          />
          <FilterBar
            view={view}
            change={change}
            heroes={heroes}
            heroIds={[...new Set(loaded.map((match) => match.hero_id))]}
            patches={loadedPatches}
            shown={matches.length}
            loaded={loaded.length}
            withoutPosition={matches.filter((match) => !matchPosition(match)).length}
            turboDefault={settings.mode === 'all'}
          />
          <div className="profile-main">
            <div className="profile-list">
              <ProfileTable
                rows={sorted}
                heroes={heroes}
                ratings={ratings}
                view={view}
                change={change}
                measured={measured}
                selected={selectedId}
                onSelect={select}
                averages={averages}
                footer={
                  <div className="profile-more">
                    <small className="muted">
                      {loaded.length} saved matches{data.hasMore || data.limited ? ' · history is incomplete' : ''}
                    </small>
                    {data.hasMore && (
                      <button className="secondary" disabled={busy} onClick={() => void load(data.nextOffset)}>
                        {busy ? 'Loading…' : 'Load older matches'}
                      </button>
                    )}
                  </div>
                }
              />
            </div>
            <aside className={`profile-aside${selected ? ' open' : ''}`}>
              {selected ? (
                <MatchDetails
                  match={selected}
                  heroes={heroes}
                  rating={ratings.get(selected.match_id)}
                  onClose={() => select(undefined)}
                />
              ) : (
                <HeroesPanel
                  matches={matches}
                  heroes={heroes}
                  ratings={ratings}
                  measured={measured}
                  selectedHero={view.hero || undefined}
                  onHero={(id) => change({ hero: view.hero === id ? 0 : id })}
                />
              )}
            </aside>
          </div>
        </>
      )}
      {!!local.unassignedMmrCount && (
        <p className="muted">
          Older entries without an account: {local.unassignedMmrCount}. They are preserved in the backup export and are
          not mixed with the current rating.
        </p>
      )}
    </section>
  );
}
