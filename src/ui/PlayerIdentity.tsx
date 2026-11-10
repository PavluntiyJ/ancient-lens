// Who a player is, wherever a player appears: avatar, country, professional badge and medal.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { BadgeCheck, UserRound } from 'lucide-react';
import { rankName } from '../shared/domain';
import { country } from '../shared/country';
import { countryCache } from '../shared/country-cache';
import { api } from './App';

/** `frame` is the in-game slot colour, drawn only when the slot order is known. */
export function Avatar({
  url,
  frame,
  children,
}: {
  url?: string;
  frame?: { name: string; hex: string; index: number };
  /** Drawn over the picture's corner, such as the country flag. */
  children?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const allowed =
    url &&
    /^https:\/\/(avatars\.(?:steamstatic\.com|fastly\.steamstatic\.com|akamai\.steamstatic\.com|cloudflare\.steamstatic\.com|steamcommunity\.com))\/[a-f0-9]+(?:_full|_medium)?\.(?:jpg|png)$/i.test(
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
      {children}
    </span>
  );
}
/** OpenDota country lookups by account, shared by every flag of that player. */
const lookupCountry = countryCache((id) => api.getCountry(id) ?? Promise.resolve(null));
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
/** The check after a professional player's name. STRATZ links the name to the account; the
 * app never guesses a professional from a nickname. */
export function ProBadge({ name }: { name: string }) {
  const label = `Professional player ${name} · name from STRATZ`;
  return (
    <span className="pro-badge" title={label} aria-label={label} role="img">
      <BadgeCheck size={15} aria-hidden />
    </span>
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
