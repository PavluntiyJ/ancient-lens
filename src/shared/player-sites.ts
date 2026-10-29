import { accountId } from './domain';
export type PlayerSite = 'dotabuff' | 'opendota' | 'stratz';
/** Sites with a page for a player; Steam has profiles but no match pages. */
export type ProfileSite = PlayerSite | 'steam';
export const playerSites: { id: PlayerSite; name: string; icon: string; host: string }[] = [
  { id: 'dotabuff', name: 'Dotabuff', icon: 'dotabuff.ico', host: 'www.dotabuff.com' },
  { id: 'opendota', name: 'OpenDota', icon: 'opendota.png', host: 'www.opendota.com' },
  { id: 'stratz', name: 'STRATZ', icon: 'stratz.ico', host: 'stratz.com' },
];
export const profileSites: { id: ProfileSite; name: string; icon: string; host: string }[] = [
  ...playerSites,
  { id: 'steam', name: 'Steam', icon: 'steam.ico', host: 'steamcommunity.com' },
];
const steamBase = 76561197960265728n;
export function playerSiteUrl(input: string, site: ProfileSite): string {
  if (site === 'steam') return `https://steamcommunity.com/profiles/${steamBase + BigInt(accountId(input))}`;
  const service = playerSites.find((row) => row.id === site);
  if (!service) throw new Error('Unknown site');
  return `https://${service.host}/players/${accountId(input)}`;
}
