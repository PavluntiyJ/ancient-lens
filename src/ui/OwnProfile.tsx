import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  matchWon,
  type Hero,
  type LocalState,
  type Match,
  type PlayerHistory,
  type SteamIdentity,
} from '../shared/domain';
import { filterHistory, patchOf, streakRun, type HistoryFilter, type Patch } from '../shared/history';
import { ownProfileRank } from '../shared/own-rank';
import { sortProfileHistory } from '../shared/profile-history';
import { ratingByMatch } from '../shared/rating-history';
import { matchPosition } from '../shared/roles';
import { api, errorMessage, Notice } from './App';
import { ProfileAccounts } from './profile/ProfileAccounts';
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
  const [selected, setSelected] = useState<string>();
  const id = selected ?? local.accountId;
  const [other, setOther] = useState<LocalState>();
  const [accountError, setAccountError] = useState('');
  useEffect(() => {
    let keep = true;
    setAccountError('');
    if (id !== local.accountId && id && api.getAccountState) {
      void api
        .getAccountState(id)
        .then((value) => {
          if (keep && value.accountId === id) setOther(value);
        })
        .catch((error) => {
          if (keep) setAccountError(errorMessage(error));
        });
    }
    return () => {
      keep = false;
    };
  }, [id, local.accountId, local.journalRevision]);
  const scoped =
    id === local.accountId
      ? local
      : other?.accountId === id
        ? other
        : {
            ...local,
            accountId: id,
            mmr: [],
            ratingSnapshot: null,
            recordedMatches: 0,
          };
  return (
    <>
      {accountError && <Notice error>{accountError}</Notice>}
      <OwnProfileContent
        local={scoped}
        update={update}
        activeAccountId={local.accountId}
        accounts={local.profileAccounts ?? []}
        choose={(id) => setSelected(id === local.accountId ? undefined : id)}
      />
    </>
  );
}

function OwnProfileContent({
  local,
  update,
  activeAccountId,
  accounts,
  choose,
}: {
  local: LocalState;
  update(state: LocalState): void;
  activeAccountId: string;
  accounts: string[];
  choose(id: string): void;
}) {
  const [identity, setIdentity] = useState<SteamIdentity>();
  const identityGeneration = useRef(0);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityError, setIdentityError] = useState('');
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

  async function refreshIdentity(refresh = false) {
    if (!local.accountId || !api.getSteamProfile) return;
    const token = ++identityGeneration.current;
    setIdentityBusy(true);
    setIdentityError('');
    try {
      const value = await api.getSteamProfile(local.accountId, refresh);
      if (mounted.current && token === identityGeneration.current && value.accountId === local.accountId)
        setIdentity(value);
    } catch (error) {
      if (mounted.current && token === identityGeneration.current) setIdentityError(errorMessage(error));
    } finally {
      if (mounted.current && token === identityGeneration.current) setIdentityBusy(false);
    }
  }
  useEffect(() => {
    setIdentity(undefined);
    setIdentityBusy(false);
    setIdentityError('');
    void refreshIdentity();
    return () => {
      // oxlint-disable-next-line react/exhaustive-deps -- a counter, not a DOM ref: the cleanup must bump its current value.
      identityGeneration.current++;
    };
    // oxlint-disable-next-line react/exhaustive-deps -- a new account loads its identity once; refreshIdentity is rebuilt every render.
  }, [local.accountId]);
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
      // oxlint-disable-next-line react/exhaustive-deps -- a counter, not a DOM ref: the cleanup must bump its current value.
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
    // oxlint-disable-next-line react/exhaustive-deps -- only a journal change reloads; an account change has its own load above.
  }, [journal]);

  const data = history?.accountId === local.accountId ? history : null;
  const loaded = useMemo(() => data?.matches ?? [], [data]);
  const rank = ownProfileRank(local, data?.profile.rank_tier, data?.profile.leaderboard_rank);
  const filter: HistoryFilter = { ...view, patches };
  const filterKey = JSON.stringify(view);
  // `filter` is a new object every render; filterKey and patches stand for its contents.
  // oxlint-disable-next-line react/exhaustive-deps -- see above.
  const matches = useMemo(() => filterHistory(loaded, filter), [loaded, filterKey, patches]);
  const allPositions = useMemo(
    () => (view.position ? filterHistory(loaded, { ...filter, position: 0 }) : matches),
    // oxlint-disable-next-line react/exhaustive-deps -- see above.
    [loaded, filterKey, patches, matches],
  );
  const ownEntries = useMemo(
    () => local.mmr.filter((entry) => entry.accountId === local.accountId),
    [local.mmr, local.accountId],
  );
  const ratings = useMemo(() => ratingByMatch(loaded, ownEntries), [loaded, ownEntries]);
  const measured = ownEntries.length > 0;
  const heroName = useCallback(
    (id: number) => heroes.find((hero) => hero.id === id)?.localized_name ?? `Hero #${id}`,
    [heroes],
  );
  const sorted = useMemo(
    () => sortProfileHistory(matches, view.sort, view.direction, heroName, ratings),
    [matches, view.sort, view.direction, heroName, ratings],
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
        busy={busy || identityBusy}
        identityError={identityError}
        identity={identity?.accountId === local.accountId ? identity : undefined}
        onRefresh={() => {
          void load();
          void refreshIdentity(true);
        }}
        accountMenu={(name) => (
          <ProfileAccounts
            name={name}
            selected={local.accountId}
            active={activeAccountId}
            accounts={accounts}
            choose={choose}
            add={async (id) => {
              // Never fall back to a full account switch; adding an alternate
              // account must leave the active account untouched.
              if (!api.addProfileAccount) throw new Error('Adding profiles is unavailable in this version');
              update(await api.addProfileAccount(id));
              choose(id);
            }}
            remove={async (id) => {
              if (!api.removeProfileAccount) throw new Error('Removing profiles is unavailable in this version');
              update(await api.removeProfileAccount(id));
              // A removed profile must not stay on screen; the game's account remains.
              if (id === local.accountId) choose(activeAccountId);
            }}
          />
        )}
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
      {/* Statistics decide: a fixture service's history is unlabelled, and so is the synthetic
          Steam identity screenshots and demos add to it. Cached isolated history is labelled. */}
      {data?.demonstration && (
        <p className="item-demo-label">Synthetic demonstration · invented profile and statistics</p>
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
