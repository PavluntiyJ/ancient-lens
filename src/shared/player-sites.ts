import { accountId } from './domain';
export type PlayerSite = 'dotabuff' | 'opendota' | 'stratz';
export const playerSites: { id: PlayerSite; name: string; icon: string; host: string }[] = [
  { id: 'dotabuff', name: 'Dotabuff', icon: 'dotabuff.ico', host: 'www.dotabuff.com' },
  { id: 'opendota', name: 'OpenDota', icon: 'opendota.png', host: 'www.opendota.com' },
  { id: 'stratz', name: 'STRATZ', icon: 'stratz.ico', host: 'stratz.com' },
];
export function playerSiteUrl(input: string, site: PlayerSite): string {
  const service = playerSites.find((row) => row.id === site);
  if (!service) throw new Error('Unknown site');
  return `https://${service.host}/players/${accountId(input)}`;
}
