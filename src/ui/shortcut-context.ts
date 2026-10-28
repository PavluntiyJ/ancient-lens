import { createContext, useContext } from 'react';
import { defaultShortcuts, type Shortcuts } from '../shared/shortcuts';

/** The stored bindings, available to every key handler and to the settings page. */
const ShortcutsContext = createContext<Shortcuts>(defaultShortcuts);
export const ShortcutsProvider = ShortcutsContext.Provider;
export function useShortcuts() {
  return useContext(ShortcutsContext);
}
