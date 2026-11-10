import { useState } from 'react';
import { Swords } from 'lucide-react';
import type { Hero } from '../shared/domain';

/** A hero's picture; its name when the picture fails, crossed swords when there is no hero. */
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
