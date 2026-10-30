import type { CSSProperties } from 'react';
import type { BracketPiece } from '../shared/parties';

/**
 * The party bracket in the gutter of one player row: a bar on the rows of a party's
 * members, a thin connector on rows between them, dashed for a likely party. The member
 * piece carries the evidence as its tooltip.
 */
export function PartyBracket({ pieces, tip }: { pieces: BracketPiece[]; tip?: string }) {
  if (!pieces.length) return null;
  return (
    <>
      {pieces.map((piece) => {
        const classes = [
          'party-bracket',
          piece.member ? 'member' : 'through',
          piece.top && 'top',
          piece.bottom && 'bottom',
          !piece.sure && 'likely',
          piece.lane && 'lane-1',
        ];
        return (
          <span
            key={piece.colour}
            className={classes.filter(Boolean).join(' ')}
            style={{ '--party': `var(--party-${piece.colour})` } as CSSProperties}
            title={piece.member ? tip : undefined}
          />
        );
      })}
    </>
  );
}
