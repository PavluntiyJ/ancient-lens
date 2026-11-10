import { useEffect, useState } from 'react';
import type { Hero } from '../../shared/domain';
import { api, errorMessage } from '../App';

/**
 * The hero list, loaded once connected and again on refresh. A failure goes to `reportError`,
 * the error the draft panels show (see `useDraftData`).
 */
export function useHeroes(connected: boolean, revision: number, reportError: (message: string) => void) {
  const [heroes, setHeroes] = useState<Hero[]>([]);
  useEffect(() => {
    if (!connected) return;
    let active = true;
    void api
      .getHeroes()
      .then((value) => {
        if (active) setHeroes(value);
      })
      .catch((error) => {
        if (active) reportError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [connected, revision, reportError]);
  return heroes;
}
