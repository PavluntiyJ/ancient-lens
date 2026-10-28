import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { TipCard, tip } from './Tooltip';

/** What a derived column means: how it is computed, where it comes from, what its colours say. */
export type ColumnInfo = { title: string; formula?: string; source: string; tones?: string };

export function ColumnTip({ info }: { info: ColumnInfo }) {
  return (
    <TipCard title={info.title} note={info.tones}>
      {info.formula && <div className="tip-formula">{info.formula}</div>}
      <div className="tip-source">Source: {info.source}</div>
    </TipCard>
  );
}

/** A header label with an ⓘ; label and icon form one focus target that opens the card. */
export function InfoHeader({ label, info }: { label: ReactNode; info: ColumnInfo }) {
  return (
    <span className="column-info" tabIndex={0} aria-label={info.title} {...tip(<ColumnTip info={info} />)}>
      {label}
      <Info size={11} aria-hidden="true" />
    </span>
  );
}

const winRateTones =
  'Win rate is green above 50% and red below once the sample is big enough: from 3 games and 3 points off 50% in the period, from 50 games and 5 points over all time.';

export const rosterColumns = {
  role: {
    title: "This match's role",
    formula:
      "A lane selected in the draft; otherwise one role per player guessed for the whole team from the period history and the hero's positions, marked Likely.",
    source: 'the draft (game), STRATZ hero positions and the player history',
  },
  totalGames: {
    title: 'Games and win rate, all time',
    formula: 'Every match the provider has for the player.',
    source: 'the selected provider (STRATZ or OpenDota); history may be incomplete',
    tones: winRateTones,
  },
  periodGames: (days: number) => ({
    title: `Games and win rate, last ${days} days`,
    formula: 'Matches in the statistics period with the selected modes.',
    source: 'the selected provider',
    tones: winRateTones,
  }),
  mainRole: {
    title: 'Main role',
    formula: 'The most played position and its share of the period matches with a known position.',
    source: 'the selected provider; matches without a position are left out',
  },
  frequent: {
    title: 'Frequent heroes',
    formula: 'Most played heroes in the period with games and win rate.',
    source: 'the selected provider',
    tones:
      'Blue frame: recent spam, all of the last 5 games or more than 6 of the last 10 on the hero. Red frame: heavy spam, 60% of 25 or more games.',
  },
  heroGames: (days: number, thin: number) => ({
    title: `Current hero, last ${days} days`,
    formula: `Matches on the hero picked in this draft and the win rate; fewer than ${thin} games are dimmed.`,
    source: 'the selected provider',
    tones: winRateTones,
  }),
  heroRole: {
    title: 'Role on this hero',
    formula: "The player's most played position on the current hero in the period.",
    source: 'the selected provider',
  },
} satisfies Record<string, ColumnInfo | ((...args: number[]) => ColumnInfo)>;
