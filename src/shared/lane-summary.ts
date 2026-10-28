import { matchupAdvantage, pairAdvantage, sumAdvantage, type DraftData } from './draft';
import type { Position } from './roles';

/** A drafted (or hovered) hero with its role in this match. */
export type LaneHero = {
  heroId?: number;
  position: Position;
  /** The role is a team-wide guess, not a lane selected in the draft. */
  guessed: boolean;
  /** Hovered, not picked yet. */
  hovered?: boolean;
};
export type LaneRow = {
  id: 'safe' | 'mid' | 'off';
  /** Radiant's lane: its safe lane meets Dire's off lane, and the reverse. */
  radiant: LaneHero[];
  dire: LaneHero[];
  /** Summed pair advantage for Radiant in percentage points; unknown while a hero is missing. */
  advantage?: number;
  pairs: { known: number; expected: number };
};
export type LaneSummary = {
  lanes: LaneRow[];
  /** Every Radiant–Dire pair (the matrix total), for Radiant. */
  counter?: number;
  /** Radiant's ally pairs minus Dire's. */
  synergy?: number;
  /** Counter plus synergy at the synergy weight of the suggestions. */
  total?: number;
};

const laneRoles = [
  { id: 'safe', radiant: [1, 5], dire: [3, 4] },
  { id: 'mid', radiant: [2], dire: [2] },
  { id: 'off', radiant: [3, 4], dire: [1, 5] },
] as const;

/** Synergy of two allies: the mean of both directed provider pairs that are usable. */
function synergyOf(data: DraftData | undefined, a: number, b: number) {
  const direction = (from: number, to: number) =>
    pairAdvantage(
      data?.matchups.find((row) => row.heroId === from)?.with.find((p) => p.heroId1 === from && p.heroId2 === to),
      'with',
      data?.rawPairs ? 0 : undefined,
    );
  const values = [direction(a, b), direction(b, a)].filter((value): value is number => value !== undefined);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}
function teamSynergy(data: DraftData | undefined, ids: number[]) {
  return sumAdvantage(ids.flatMap((a, i) => ids.slice(i + 1).map((b) => synergyOf(data, a, b))));
}

/**
 * Lane matchups of a draft: who wins which lane by the matchup pairs of the heroes in it,
 * and totals for the whole draft. A position nobody holds stays an empty hero.
 */
export function laneSummary(
  radiant: LaneHero[],
  dire: LaneHero[],
  data: DraftData | undefined,
  synergyWeight: number,
): LaneSummary {
  const at = (team: LaneHero[], position: Position): LaneHero =>
    team.find((hero) => hero.position === position) ?? { position, guessed: false };
  const lanes = laneRoles.map((lane): LaneRow => {
    const r = lane.radiant.map((position) => at(radiant, position));
    const d = lane.dire.map((position) => at(dire, position));
    const values = r.flatMap((a) =>
      d.map((b) =>
        a.heroId === undefined || b.heroId === undefined ? undefined : matchupAdvantage(data, a.heroId, b.heroId),
      ),
    );
    const complete = [...r, ...d].every((hero) => hero.heroId !== undefined);
    return {
      id: lane.id,
      radiant: r,
      dire: d,
      advantage: complete ? sumAdvantage(values) : undefined,
      pairs: { known: values.filter((value) => value !== undefined).length, expected: values.length },
    };
  });
  const ids = (team: LaneHero[]) => [
    ...new Set(team.flatMap((hero) => (hero.heroId === undefined ? [] : [hero.heroId]))),
  ];
  const counter = sumAdvantage(ids(radiant).flatMap((a) => ids(dire).map((b) => matchupAdvantage(data, a, b))));
  const own = teamSynergy(data, ids(radiant));
  const other = teamSynergy(data, ids(dire));
  const synergy = own === undefined && other === undefined ? undefined : (own ?? 0) - (other ?? 0);
  const weight = Math.max(0, Math.min(100, synergyWeight)) / 100;
  const total = counter === undefined && synergy === undefined ? undefined : (counter ?? 0) + (synergy ?? 0) * weight;
  return { lanes, counter, synergy, total };
}
