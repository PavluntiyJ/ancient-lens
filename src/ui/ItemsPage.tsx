import { useEffect, useRef, useState } from 'react';
import type { Hero, LiveState } from '../shared/domain';
import { itemContext } from '../shared/item-build';
import { holdMatch, type HeldMatch } from '../shared/match-session';
import { ItemBuild } from './ItemBuild';
import { api } from './App';

export function ItemsPage({
  live,
  connected,
  ownAccountId,
  active,
}: {
  live: LiveState;
  connected: boolean;
  ownAccountId: string;
  active: boolean;
}) {
  const held = useRef<HeldMatch | undefined>(undefined);
  const current = holdMatch(held.current, live, connected, Date.now());
  held.current = current.held;
  const [heroes, setHeroes] = useState<Hero[]>([]);
  useEffect(() => {
    let keep = true;
    if (active)
      void api
        .getHeroes()
        .then((rows) => {
          if (keep) setHeroes(rows);
        })
        .catch(() => {});
    return () => {
      keep = false;
    };
  }, [active]);
  const view = current.view;
  // Frozen-clock: when the socket drops, holdMatch freezes `now` at the last
  // observedAt so visibleDraftPicks' 15s freshness check still passes. Don't
  // "simplify" the connected flag — suspended/lingering matches still need
  // draft context, otherwise item recommendations silently disappear.
  const now = current.frozen ? (view.draft?.observedAt ?? view.receivedAt ?? Date.now()) : Date.now();
  const contextConnected = connected || current.suspended || current.lingering;
  return (
    <section className="items-page" aria-label="Item build page">
      <div className="page-heading">
        <h1>Item build</h1>
        <p>Your standard build, followed by useful options for this match.</p>
      </div>
      <ItemBuild
        context={itemContext(view, ownAccountId, contextConnected, now)}
        scope={`${view.matchId ?? ''}:${ownAccountId}`}
        heroes={heroes}
        active={active}
      />
    </section>
  );
}
