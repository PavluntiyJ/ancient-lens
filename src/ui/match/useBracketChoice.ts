import { useEffect, useRef } from 'react';
import { chooseBracket, matchMedalTier, type BracketChoice } from '../../shared/rank-bracket';
import { api } from '../App';
import { useRankBracket } from '../preferences';

/**
 * The rank bracket of the match's hero statistics, from the setting and the players' medals,
 * else the own medal or MMR. An automatic choice is kept for the match once it rests on ranks,
 * so profiles loading mid-draft do not refetch every table. For an own match, the median medal
 * goes to the journal, so its profile row has a bracket before STRATZ ranks the match.
 */
export function useBracketChoice({
  match,
  player,
  matchTiers,
  ownTier,
  ownMmr,
}: {
  match: string;
  /** The match is the user's own (not spectated). */
  player: boolean;
  /** Each roster player's medal tier, where known. */
  matchTiers: (number | null | undefined)[];
  ownTier?: number | null;
  ownMmr?: number | null;
}) {
  const bracketSetting = useRankBracket();
  const chosen = chooseBracket(bracketSetting, { matchTiers, ownTier, ownMmr });
  const medal = player ? matchMedalTier(matchTiers) : undefined;
  useEffect(() => {
    if (match && medal) void api.setMedalRank(match, medal).catch(() => {});
  }, [match, medal]);
  const bracketFor = useRef<{ key: string; choice: BracketChoice }>(undefined);
  const bracketKey = `${match}-${bracketSetting}`;
  if (bracketFor.current?.key !== bracketKey || bracketFor.current.choice.source === 'none')
    bracketFor.current = { key: bracketKey, choice: chosen };
  return bracketFor.current.choice.bracket;
}
