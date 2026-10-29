import { Activity, BookOpen, LayoutDashboard, Settings, Swords, UserRound, Users } from 'lucide-react';

export const pages = [
  { id: 'home', name: 'Match and draft', icon: LayoutDashboard },
  { id: 'draft', name: 'Manual draft', icon: Swords },
  { id: 'roster', name: 'Manual roster', icon: Users },
  { id: 'profile', name: 'My profile', icon: UserRound },
  { id: 'notes', name: 'Notes', icon: BookOpen },
  { id: 'live', name: 'GSI diagnostics', icon: Activity },
  { id: 'settings', name: 'Settings', icon: Settings },
] as const;
export type Page = (typeof pages)[number]['id'];

const headerPages: Page[] = ['home', 'profile', 'notes', 'settings'];
// The tools have no header icon: they open from the screen that needs them, and the icon of
// that screen stays lit while they are open.
const parentPage: Partial<Record<Page, Page>> = { draft: 'home', roster: 'home', live: 'settings' };

export function HeaderNav({ page, open }: { page: Page; open(page: Page): void }) {
  const lit = parentPage[page] ?? page;
  return (
    <nav aria-label="Sections">
      {pages
        .filter((item) => headerPages.includes(item.id))
        .map((item) => (
          <button
            key={item.id}
            className={lit === item.id ? 'active' : ''}
            aria-label={item.name}
            title={item.name}
            aria-current={page === item.id ? 'page' : undefined}
            onClick={() => open(item.id)}
          >
            <item.icon size={16} />
            <span className="sr-only">{item.name}</span>
          </button>
        ))}
    </nav>
  );
}
