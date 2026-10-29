// Settings groups and the element id of each section, for the side list and for links that
// open a section from elsewhere (the match screen, GSI diagnostics).
export const settingsGroups = [
  {
    id: 'connections',
    name: 'Connections',
    sections: [
      ['settings-game', 'Dota 2'],
      ['settings-provider', 'STRATZ'],
      ['settings-reader', 'Memory reading'],
    ],
  },
  { id: 'match', name: 'Match & statistics', sections: [['settings-statistics', 'Match statistics']] },
  {
    id: 'interface',
    name: 'Interface',
    sections: [
      ['settings-appearance', 'Appearance'],
      ['settings-shortcuts', 'Shortcuts'],
      ['settings-sound', 'Sound'],
      ['settings-window', 'Window'],
    ],
  },
  {
    id: 'data',
    name: 'Data',
    sections: [
      ['settings-data', 'Your data'],
      ['settings-updates', 'Updates'],
    ],
  },
] as const;
export type SettingsSection = (typeof settingsGroups)[number]['sections'][number][0];

export function showSection(id: SettingsSection, behavior: ScrollBehavior = 'smooth') {
  document.getElementById(id)?.scrollIntoView({ block: 'start', behavior });
}
