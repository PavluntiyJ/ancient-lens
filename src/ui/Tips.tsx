import type { ReactNode } from 'react';
import { formatDecimal, matchWon, type Hero, type Match } from '../shared/domain';
import type { PositionSuggestion } from '../shared/draft';
import type { Ranking } from '../shared/match-rank';
import type { ChartPoint } from '../shared/mmr-chart';
import type { LaneRow } from '../shared/lane-summary';
import type { MetaPick } from '../shared/meta-picks';
import { formatImp, impTier, impTiers } from '../shared/performance';
import type { RoleGuess } from '../shared/role-guess';
import { matchPosition, rankedRoles, type Position } from '../shared/roles';
import { statBandLabels, type StatBand } from '../shared/stat-bands';
import { Portrait } from './MatchScreen';
import { RoleIcon } from './Roles';
import { TipCard } from './Tooltip';

// Hover-card contents of the match screen's and profile's data surfaces (see Tooltip.tsx).

const signed = (value: number, digits = 2) =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatDecimal(Math.abs(value), digits)}`;
const tone = (value: number) => (value > 0 ? 'tip-positive' : value < 0 ? 'tip-negative' : undefined);
const percent = (wins: number, games: number) => (games ? Math.round((wins / games) * 100) : 0);

export function RoleTip({ role, heroName, days }: { role: RoleGuess; heroName?: string; days: number }) {
  const name = rankedRoles.find((item) => item.id === role.position)!.name;
  if (!role.guessed)
    return <TipCard icon={<RoleIcon position={role.position} />} title={name} note="Selected in the draft" />;
  return (
    <TipCard
      icon={<RoleIcon position={role.position} />}
      title={name}
      tag="Likely"
      rows={[
        [
          `Player, last ${days} days`,
          role.player ? `${role.player.games} of ${role.player.known} games` : 'Private or no games',
        ],
        ...(role.hero && heroName
          ? [[`${heroName} in this role`, `${Math.round(role.hero.share * 100)}% of games`] as [string, string]]
          : []),
      ]}
      note="Guessed for the whole team: each player gets one role."
    />
  );
}

export function MatchupTip({
  radiant,
  dire,
  value,
  provisional,
  note,
}: {
  radiant?: Hero;
  dire?: Hero;
  value?: number;
  provisional?: boolean;
  note: string;
}) {
  return (
    <TipCard
      title={
        <>
          <Portrait hero={radiant} />
          {radiant?.localized_name ?? 'Empty slot'}
          <span className="tip-vs">vs</span>
          <Portrait hero={dire} />
          {dire?.localized_name ?? 'Empty slot'}
        </>
      }
      note={[provisional && 'Tentative: a hovered hero.', note].filter(Boolean).join(' ')}
    >
      <div className="tip-value">
        {value === undefined ? (
          'Not enough data'
        ) : (
          <>
            <b className={tone(value)}>+{formatDecimal(Math.abs(value), 2)} pp</b>
            {Math.abs(value) < 0.005 ? 'even' : `for ${value > 0 ? 'Radiant' : 'Dire'}`}
          </>
        )}
      </div>
    </TipCard>
  );
}

export function FrequentHeroTip({
  hero,
  games,
  wins,
  pool,
}: {
  hero?: Hero;
  games: number;
  wins: number;
  pool?: string;
}) {
  const rate = percent(wins, games);
  return (
    <TipCard
      icon={<Portrait hero={hero} />}
      title={hero?.localized_name ?? 'Unknown hero'}
      rows={[
        ['Games', games],
        ['Win rate', <span className={tone(rate - 50)}>{rate}%</span>],
      ]}
      note={pool}
    />
  );
}

export function SuggestionTip({ row, weight }: { row: PositionSuggestion; weight: number }) {
  return (
    <TipCard
      icon={<Portrait hero={row.hero} />}
      title={row.hero.localized_name}
      rows={[
        ['Against opponents', signed(row.counter)],
        [`With allies (${weight}%)`, signed(row.synergy)],
        ['Win rate in position', `${formatDecimal(row.base)}%`],
        ['Known pairs', `${row.coverage} of ${row.expected}`],
        ['Matches in position', row.games.toLocaleString('en-US')],
      ]}
      note="Percentage points over the position average."
    >
      <div className="tip-value">
        <b className={tone(row.score)}>{signed(row.score)}</b>advantage
      </div>
    </TipCard>
  );
}

export function MetaTip({ pick, note }: { pick: MetaPick; note?: string }) {
  return (
    <TipCard
      icon={<Portrait hero={pick.hero} />}
      title={pick.hero.localized_name}
      tag={pick.banned ? 'Banned' : undefined}
      rows={[
        ['Win rate', `${formatDecimal(pick.winRate)}%`],
        ['Matches in this role', pick.games.toLocaleString('en-US')],
      ]}
      note={`A main role: at least 20% of its games. Ranked by win rate adjusted for sample size.${note ? ` ${note}` : ''}`}
    />
  );
}

export function CounterTip({
  hero,
  enemy,
  advantage,
  multiple,
}: {
  hero: Hero;
  enemy: Hero;
  advantage: number;
  multiple?: boolean;
}) {
  return (
    <TipCard
      icon={<Portrait hero={hero} />}
      title={hero.localized_name}
      note={multiple ? 'Also counters other enemy heroes.' : undefined}
    >
      <div className="tip-value">
        <b className={tone(advantage)}>{signed(advantage)} pp</b>against {enemy.localized_name}
      </div>
    </TipCard>
  );
}

/** The ten players of a match by one statistic, best first, a bar scaled to the match range. */
export function RankList({
  ranking,
  format,
  heroOf,
}: {
  ranking: Ranking;
  format: (value: number) => ReactNode;
  heroOf: (id: number | undefined) => Hero | undefined;
}) {
  return (
    <ol className="match-rank">
      {ranking.rows.map(({ entry, value }, index) => (
        <li key={index} className={entry.own ? 'own' : undefined}>
          <Portrait hero={heroOf(entry.hero_id)} />
          <RoleIcon position={matchPosition({ position: entry.position })} />
          <span className="match-rank-name">
            {index + 1}.{' '}
            {entry.own ? 'You' : (heroOf(entry.hero_id)?.localized_name ?? `Hero #${entry.hero_id ?? '?'}`)}
          </span>
          <b>{value === undefined ? '—' : format(value)}</b>
        </li>
      ))}
    </ol>
  );
}

/**
 * A profile statistic: one line saying why it has its colour ("Bad · 11 vs 5.6 avg Enigma
 * Off Lane"), then the ten players of the match. Without an average the line says so.
 */
export function StatCard({
  label,
  value,
  band,
  average,
  heroName,
  position,
  ranking,
  format,
  heroOf,
}: {
  label: string;
  value: string;
  band: StatBand | null;
  average?: string;
  heroName: string;
  position?: Position;
  ranking?: Ranking;
  format: (value: number) => ReactNode;
  heroOf: (id: number | undefined) => Hero | undefined;
}) {
  const role = rankedRoles.find((role) => role.id === position)?.name;
  return (
    <TipCard title={label} value={value}>
      <p className="tip-verdict">
        {band !== null && average !== undefined && role ? (
          <>
            <b className={band === 3 ? undefined : `stat-band-${band}`}>{statBandLabels[band]}</b> · {value} vs{' '}
            {average} avg {heroName} {role}
          </>
        ) : position ? (
          'No bracket average yet'
        ) : (
          'Position unknown: no comparison'
        )}
      </p>
      {ranking && <RankList ranking={ranking} format={format} heroOf={heroOf} />}
    </TipCard>
  );
}

const pointTime = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** One rating measurement of the MMR chart: when, how much, from where, and its match. */
export function MmrPointTip({ point, match, hero }: { point: ChartPoint; match?: Match; hero?: Hero }) {
  const won = match ? matchWon(match) : null;
  return (
    <TipCard
      title={pointTime(point.at)}
      tag={point.source === 'manual' ? 'Manual' : undefined}
      rows={[
        ['Source', point.source === 'dota-memory' ? 'Measured from the game' : 'Entered manually'],
        ...(typeof point.confidence === 'number'
          ? [['Confidence', `${Math.round(point.confidence)}%`] as [string, string]]
          : []),
        ...(match
          ? [
              [
                'After match',
                <span className="tip-match">
                  <Portrait hero={hero} />
                  {hero?.localized_name ?? `Hero #${match.hero_id}`}
                  {won !== null && <b className={won ? 'tip-positive' : 'tip-negative'}>{won ? 'Win' : 'Loss'}</b>}
                </span>,
              ] as [string, ReactNode],
            ]
          : []),
      ]}
      note="Local time of the measurement. Points are evenly spaced; check the dates for gaps."
    >
      <div className="tip-value">
        <b>{point.value.toLocaleString('en-US')}</b>
        {point.delta === undefined ? (
          'first measurement'
        ) : (
          <span className={tone(point.delta)}>
            {point.delta > 0 ? '+' : point.delta < 0 ? '−' : '±'}
            {Math.abs(point.delta)} since the previous
          </span>
        )}
      </div>
    </TipCard>
  );
}

const laneTitles = {
  safe: 'Radiant safe lane vs Dire off lane',
  mid: 'Mid vs mid',
  off: 'Radiant off lane vs Dire safe lane',
};

/** One lane of the lane summary: its heroes and how the advantage was summed. */
export function LaneTip({ lane, heroes, note }: { lane: LaneRow; heroes: Hero[]; note: string }) {
  const name = (id?: number) =>
    id === undefined ? 'Empty slot' : (heroes.find((hero) => hero.id === id)?.localized_name ?? `#${id}`);
  const value = lane.advantage;
  const missing = [...lane.radiant, ...lane.dire].some((hero) => hero.heroId === undefined);
  const guessed = [...lane.radiant, ...lane.dire].some((hero) => hero.guessed && hero.heroId !== undefined);
  return (
    <TipCard
      title={laneTitles[lane.id]}
      tag={guessed ? 'Likely' : undefined}
      rows={[
        ['Radiant', lane.radiant.map((hero) => name(hero.heroId)).join(', ')],
        ['Dire', lane.dire.map((hero) => name(hero.heroId)).join(', ')],
        ['Pairs with data', `${lane.pairs.known} of ${lane.pairs.expected}`],
      ]}
      note={[
        'Sum of the matchup advantages of the heroes in this lane.',
        guessed && 'Some roles are guessed for the team.',
        note,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="tip-value">
        {value === undefined ? (
          missing ? (
            'Waiting for every hero of the lane'
          ) : (
            'Not enough data'
          )
        ) : (
          <>
            <b className={value > 0 ? 'tip-positive' : value < 0 ? 'tip-negative' : undefined}>
              +{formatDecimal(Math.abs(value), 2)} pp
            </b>
            {Math.abs(value) < 0.005 ? 'even' : `for ${value > 0 ? 'Radiant' : 'Dire'}`}
          </>
        )}
      </div>
    </TipCard>
  );
}
