import { useEffect, useRef, useState } from 'react';
import { draftLanes, laneForPosition, type Position } from '../../shared/draft';
import { matchesShortcut } from '../../shared/shortcuts';
import { shortcutBlocked } from '../DraftPanels';
import { useShortcuts } from '../shortcut-context';

const saved = () => {
  const value = Number(localStorage.getItem('preferred-lane'));
  return Number.isInteger(value) && value >= 0 && value < draftLanes.length ? value : 0;
};

/**
 * The lane both suggestion panels show (an index into `draftLanes`). It starts from the last
 * lane chosen, follows the own assigned position once per match, and the stored lane keys
 * cycle it while the screen is active. Once the user picks a lane in a match, the position no
 * longer moves it there.
 */
export function useLaneChoice(match: string, active: boolean, ownPosition: Position | undefined) {
  const [lane, setLaneState] = useState(saved);
  // Match whose lane was already chosen (automatically or by the user).
  const laneDecided = useRef('');
  const currentMatch = useRef('');
  currentMatch.current = match;
  const setLane = (index: number) => {
    laneDecided.current = currentMatch.current;
    localStorage.setItem('preferred-lane', String(index));
    setLaneState(index);
  };
  const shortcuts = useShortcuts();
  useEffect(() => {
    if (!active) return;
    // The stored keys cycle the lane shared by both panels.
    const keydown = (event: KeyboardEvent) => {
      if (shortcutBlocked(event)) return;
      const direction = matchesShortcut(event, shortcuts.laneNext)
        ? 1
        : matchesShortcut(event, shortcuts.lanePrevious)
          ? -1
          : 0;
      if (!direction) return;
      event.preventDefault();
      laneDecided.current = currentMatch.current;
      setLaneState((index) => {
        const next = (index + direction + draftLanes.length) % draftLanes.length;
        localStorage.setItem('preferred-lane', String(next));
        return next;
      });
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [active, shortcuts.lanePrevious, shortcuts.laneNext]);
  // The suggestion lane follows the own assigned role once per match.
  useEffect(() => {
    if (!match || ownPosition === undefined || laneDecided.current === match) return;
    laneDecided.current = match;
    setLaneState(laneForPosition(ownPosition));
  }, [match, ownPosition]);
  return { lane, setLane };
}
