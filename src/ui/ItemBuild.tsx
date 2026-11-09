import { useEffect, useState } from 'react';
import type { Hero } from '../shared/domain';
import { parseItemData, rankItems, type ItemContext, type ItemData } from '../shared/item-build';
import { api, errorMessage } from './App';

const date = (seconds: number | null) =>
  seconds === null ? '—' : new Date(seconds * 1000).toLocaleDateString('en-GB');

export function ItemBuild({
  context,
  heroes,
  scope,
  active = true,
}: {
  context?: ItemContext;
  heroes: Hero[];
  scope: string;
  active?: boolean;
}) {
  const [cache, setCache] = useState<Record<string, ItemData>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [retry, setRetry] = useState(0);
  const [buildChoice, setBuildChoice] = useState({ key: '', index: 0 });
  const key = `${scope}:${context?.heroId ?? ''}`;
  const heroId = context?.heroId;
  useEffect(() => {
    let current = true;
    if (!active || !heroId) return;
    // Cache per key so toggling between heroes doesn't refetch cached
    // samples; only show loading when this key has no data yet.
    // A previously stored sample is still shown; a failed retry keeps the last error until it clears.
    if (cache[key]) return;
    setLoading((prev) => ({ ...prev, [key]: true }));
    void api
      .getItemStats(heroId)
      .then((raw) => {
        const data = parseItemData(raw, heroId);
        if (current) {
          setCache((prev) => ({ ...prev, [key]: data }));
          // A successful retry supersedes the previous error notice.
          setErrors((prev) => {
            const { [key]: _, ...rest } = prev;
            return rest;
          });
        }
      })
      .catch((error) => {
        if (current) setErrors((prev) => ({ ...prev, [key]: errorMessage(error) }));
      })
      .finally(() => {
        if (current) setLoading((prev) => ({ ...prev, [key]: false }));
      });
    return () => {
      current = false;
    };
  }, [heroId, key, retry, active]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = cache[key];
  const error = errors[key];
  const isLoading = loading[key] || (!data && !error);
  const builds = data?.standardBuilds ?? [];
  const selectedBuild = buildChoice.key === key ? Math.min(buildChoice.index, Math.max(0, builds.length - 1)) : 0;
  const build = builds[selectedBuild];
  const standardItems = build?.items ?? [];
  const options = data && context ? rankItems(data, context).slice(0, 6) : [];
  const name = (id: number) => heroes.find((h) => h.id === id)?.localized_name ?? `Hero #${id}`;
  if (!context)
    return (
      <p className="rail-empty">Waiting for your confirmed hero and team. Item options follow the player marked YOU.</p>
    );
  return (
    <section className="item-build" aria-label="Item recommendations">
      <div className="item-build-heading">
        <b>
          {name(context.heroId)} <span className="self-badge">YOU</span>
        </b>
        <small>Enemies first · allies ≤50%</small>
      </div>
      {isLoading && <p role="status">Loading purchase statistics…</p>}
      {error && (
        <div className="item-build-error" role="alert">
          <p>{error}</p>
          <button className="secondary" onClick={() => setRetry((n) => n + 1)}>
            Retry item statistics
          </button>
        </div>
      )}
      {data && (
        <>
          {data.demonstration && <b className="item-demo-label">Synthetic demonstration · invented statistics</b>}
          {data.stale && <p className="item-sample-notice">Saved statistics · refresh unavailable</p>}
          <section className="standard-build" aria-label="Standard build">
            <h2>Standard build</h2>
            <p className="item-section-note">
              Popular equipment observed together on {name(context.heroId)}. Independent of this draft.
            </p>
            {builds.length > 1 && (
              <div className="standard-build-choices" role="tablist" aria-label="Standard build variants">
                {builds.map((variant, index) => (
                  <button
                    key={index}
                    role="tab"
                    aria-selected={selectedBuild === index}
                    onClick={() => setBuildChoice({ key, index })}
                  >
                    {index === 0 ? 'Most popular' : index === 1 ? '2nd most popular' : '3rd most popular'}{' '}
                    <small>{variant.matches} matches</small>
                  </button>
                ))}
              </div>
            )}
            {build && (
              <p className="item-section-note">
                This set appeared in {build.matches} sampled {build.matches === 1 ? 'match' : 'matches'} ·{' '}
                {((100 * build.wins) / build.matches).toFixed(1)}% wins.
              </p>
            )}
            <ol className="standard-items">
              {standardItems.map((item, index) => (
                <li key={item.itemId} data-standard-item={item.itemId}>
                  <span className="standard-step">{index + 1}</span>
                  <img
                    alt=""
                    src={`https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/${item.name}.png`}
                  />
                  <b>{item.label}</b>
                  <small>{item.cost.toLocaleString('en-US')} gold</small>
                </li>
              ))}
            </ol>
            {!standardItems.length && (
              <p className="item-sample-notice">A standard build is not available in this sample yet.</p>
            )}
          </section>
          <section className="situational-build" aria-label="Good items this game">
            <div className="item-section-heading">
              <h2>Good items this game</h2>
              <small>Against {context.enemies.length}/5 known enemies</small>
            </div>
            <p className="item-section-note">
              Consider these alongside the standard build. Items that help against several enemies rise together.
            </p>
            <div className="item-draft-teams">
              <span>
                Enemies: {context.enemies.length ? context.enemies.map(name).join(' · ') : 'Waiting for picks'}
              </span>
              <span>Allies: {context.allies.length ? context.allies.map(name).join(' · ') : 'Not provided'}</span>
            </div>
            <div className="item-options">
              {options.map((option) => {
                const reasons = option.evidence.filter((e) => e.relation === 'enemy' && e.adjustment > 0);
                return (
                  <details className="item-option" key={option.item.itemId} data-item-id={option.item.itemId}>
                    <summary>
                      <img
                        alt=""
                        loading="lazy"
                        src={`https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/${option.item.name}.png`}
                      />
                      <span>
                        <b>{option.item.label}</b>
                        <small>Good against {reasons.map((e) => name(e.heroId)).join(', ')}</small>
                        <small>
                          {option.enemyCoverage}/{context.enemies.length} enemies measured
                          {standardItems.some((i) => i.itemId === option.item.itemId)
                            ? ' · already in the standard build'
                            : ''}
                        </small>
                      </span>
                      <strong className="item-coverage" title="Known enemies with a positive measured item association">
                        {reasons.length} {reasons.length === 1 ? 'enemy' : 'enemies'}
                      </strong>
                    </summary>
                    <div className="item-evidence">
                      <p>
                        {option.item.cost.toLocaleString('en-US')} gold. Consider this alongside the standard build; it
                        is not an automatic replacement. Current inventories are not known.
                      </p>
                      {option.evidence.map((e) => (
                        <p key={`${e.relation}-${e.heroId}`}>
                          {e.relation === 'enemy' ? 'Against' : 'With'} <b>{name(e.heroId)}</b>:{' '}
                          {e.withWinRate.toFixed(1)}% with this purchase ({e.withGames} games),{' '}
                          {e.withoutWinRate.toFixed(1)}% without ({e.withoutGames} games).
                        </p>
                      ))}
                      <p>
                        Historical purchases by {name(context.heroId)}. The index adjusts for the item's results outside
                        each matchup and reduces small samples. Association, not proof of benefit.
                      </p>
                    </div>
                  </details>
                );
              })}
              {!options.length && (
                <p className="item-sample-notice">
                  {context.enemies.length
                    ? 'Matchup evidence is limited. Start with the standard build; no extra items are suggested yet.'
                    : 'The standard build is ready. Situational suggestions will appear as enemies are confirmed.'}
                </p>
              )}
            </div>
          </section>
          <p className="item-data-note">
            {data.demonstration ? 'Demonstration' : data.source} · {data.sampleMatches.toLocaleString('en-US')} league
            matches · {date(data.oldest)}–{date(data.newest)}
            <br />
            All roles and ranks · may span patches · fetched {new Date(data.fetchedAt).toLocaleString('en-GB')}
          </p>
        </>
      )}
    </section>
  );
}
