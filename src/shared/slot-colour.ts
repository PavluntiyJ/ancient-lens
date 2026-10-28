/** Dota 2 player colours by player ID: Radiant 0–4, Dire 5–9, as on the scoreboard. */
export const slotColours = [
  { name: 'Blue', hex: '#3375ff' },
  { name: 'Teal', hex: '#66ffbf' },
  { name: 'Purple', hex: '#bf00bf' },
  { name: 'Yellow', hex: '#f3f00b' },
  { name: 'Orange', hex: '#ff6b00' },
  { name: 'Pink', hex: '#fe86c2' },
  { name: 'Olive', hex: '#a1b447' },
  { name: 'Light Blue', hex: '#65d9f7' },
  { name: 'Green', hex: '#008321' },
  { name: 'Brown', hex: '#a46900' },
] as const;

/**
 * A player's colour, only when the frame carries slot order: the player ID of a spectator
 * GSI key (`team2.player0`) or of a Linux draft slot. Without it, or when the ID belongs to
 * the other side, there is no colour rather than a guessed one.
 */
export function slotColour(team: 'radiant' | 'dire', row: { slot?: number }, player?: { key: string }) {
  const spectator = /^team[23]\.player(\d)$/.exec(player?.key ?? '');
  const index = spectator ? Number(spectator[1]) : row.slot;
  if (index === undefined || !Number.isInteger(index) || index < 0 || index > 9) return undefined;
  if (index < 5 !== (team === 'radiant')) return undefined;
  return { index, ...slotColours[index]! };
}
