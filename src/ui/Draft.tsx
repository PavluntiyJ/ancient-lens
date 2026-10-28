import { useEffect, useState } from 'react';
import { RotateCcw, Sparkles, Swords, X } from 'lucide-react';
import { formatDecimal, type DraftInput, type DraftResult, type Hero } from '../shared/domain';
import { api, Empty, errorMessage, Notice, number, PageHeading } from './App';

export function Draft({ active }: { active: boolean }) {
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [input, setInput] = useState<DraftInput>({ allies: [], enemies: [], bans: [], role: '' });
  const [target, setTarget] = useState<'allies' | 'enemies' | 'bans'>('enemies');
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<DraftResult>();
  const [busy, setBusy] = useState(false);
  const [loadingHeroes, setLoadingHeroes] = useState(false);
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);
  async function loadHeroes() {
    setError('');
    setLoadingHeroes(true);
    setAttempted(true);
    try {
      setHeroes(await api.getHeroes());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoadingHeroes(false);
    }
  }
  useEffect(() => {
    if (active && !attempted && api) void loadHeroes();
  }, [active, attempted]);
  const selected = new Set([...input.allies, ...input.enemies, ...input.bans]);
  function change(next: DraftInput) {
    setInput(next);
    setResult(undefined);
  }
  function add(id: number) {
    if (busy || selected.has(id) || input[target].length >= (target === 'bans' ? 30 : 5)) return;
    change({ ...input, [target]: [...input[target], id] });
  }
  async function calculate() {
    setBusy(true);
    setError('');
    setResult(undefined);
    try {
      setResult(await api.getDraft(input));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="01 / BEFORE THE MATCH"
        title="A strong draft starts here"
        description="Select the heroes already picked. Compare candidates using their statistics against the enemy team."
      />
      <Notice>
        Select heroes manually here. Suggestions use OpenDota matchup data; live draft tracking is available on the
        Match and draft screen where supported.
      </Notice>
      {error && (
        <Notice error>
          {error}
          {!heroes.length && (
            <button className="text-button" onClick={() => void loadHeroes()} disabled={loadingHeroes}>
              Retry loading
            </button>
          )}
        </Notice>
      )}
      <div className="draft-teams">
        {(['allies', 'enemies', 'bans'] as const).map((team) => (
          <section key={team} className={`panel draft-team ${target === team ? 'selected' : ''}`}>
            <button className="team-heading" onClick={() => setTarget(team)} disabled={busy}>
              <span className={`dot ${team === 'allies' ? 'online' : team === 'enemies' ? 'red' : ''}`} />
              <b>{team === 'allies' ? 'Your team' : team === 'enemies' ? 'Opponents' : 'Bans'}</b>
              <small>
                {input[team].length} / {team === 'bans' ? 30 : 5}
              </small>
            </button>
            <div className="pick-slots">
              {input[team].map((id) => (
                <button
                  className="hero-chip"
                  key={id}
                  disabled={busy}
                  onClick={() => change({ ...input, [team]: input[team].filter((value) => value !== id) })}
                >
                  {heroes.find((hero) => hero.id === id)?.localized_name ?? id}
                  <X size={13} />
                </button>
              ))}
              {!input[team].length && (
                <button className="empty-slot" onClick={() => setTarget(team)}>
                  + Add hero
                </button>
              )}
            </div>
          </section>
        ))}
      </div>
      <div className="draft-layout">
        <section className="panel">
          <div className="section-title">
            <h2>Heroes</h2>
            <span className="badge">
              Adding: {target === 'enemies' ? 'opponents' : target === 'allies' ? 'allies' : 'bans'}
            </span>
          </div>
          <input
            aria-label="Search heroes"
            className="full-input"
            placeholder="Find a hero…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {loadingHeroes ? (
            <p className="muted">Loading heroes…</p>
          ) : (
            <div className="hero-picker">
              {heroes
                .filter((hero) => hero.localized_name.toLowerCase().includes(search.toLowerCase()))
                .sort((a, b) => a.localized_name.localeCompare(b.localized_name))
                .map((hero) => (
                  <button
                    key={hero.id}
                    className={`hero-option attr-${hero.primary_attr}`}
                    disabled={selected.has(hero.id) || busy || input[target].length >= (target === 'bans' ? 30 : 5)}
                    onClick={() => add(hero.id)}
                  >
                    <span>{hero.localized_name.slice(0, 2).toUpperCase()}</span>
                    {hero.localized_name}
                  </button>
                ))}
            </div>
          )}
        </section>
        <section className="panel recommendations">
          <div className="section-title">
            <h2>
              <Sparkles size={18} /> Suggested picks
            </h2>
            <button
              className="icon-button"
              aria-label="Reset draft"
              disabled={busy}
              onClick={() => change({ allies: [], enemies: [], bans: [], role: '' })}
            >
              <RotateCcw size={16} />
            </button>
          </div>
          <label className="field-label">
            Hero role
            <select value={input.role} disabled={busy} onChange={(e) => change({ ...input, role: e.target.value })}>
              <option value="">All roles</option>
              {['Carry', 'Support', 'Nuker', 'Disabler', 'Durable', 'Escape', 'Pusher', 'Initiator'].map((role) => (
                <option key={role}>{role}</option>
              ))}
            </select>
          </label>
          <button
            className="primary full-width"
            disabled={busy || !input.enemies.length || !heroes.length}
            onClick={() => void calculate()}
          >
            {busy ? 'Comparing matchups…' : 'Find heroes'}
            <Swords size={17} />
          </button>
          {result ? (
            <>
              <p className="fine-print">Matchup index · higher is better · not a win probability</p>
              {result.suggestions.slice(0, 10).map((entry, i) => (
                <div className="suggestion" key={entry.hero.id}>
                  <span className="hero-index">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <b>{entry.hero.localized_name}</b>
                    <small>
                      {number(entry.games)} pair observations · {entry.coverage}/{input.enemies.length} opponents
                    </small>
                  </div>
                  <strong className="green">{formatDecimal(entry.score)}</strong>
                </div>
              ))}
              {!result.suggestions.length && (
                <Empty title="Not enough data">Try different roles or enemy heroes.</Empty>
              )}
            </>
          ) : (
            <Empty icon={<Swords size={30} />} title="Who is on the other side?">
              Add at least one opponent and click “Find heroes”.
            </Empty>
          )}
          <details>
            <summary>How recommendations work</summary>
            <p className="fine-print">
              We take the win rate of each candidate against each selected opponent, add 100 virtual matches with a 50%
              win rate, and average the results. At least 30 observations per pair are required. Full roster coverage
              comes first, then the index. Allies and bans are excluded from candidates. Synergy, lane, rank, and patch
              are not included in this view. Samples may overlap.
            </p>
          </details>
        </section>
      </div>
    </>
  );
}
