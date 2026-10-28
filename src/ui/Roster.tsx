import { useRef, useState } from 'react';
import { Users } from 'lucide-react';
import { CountryFlag } from './MatchScreen';
import { PlayerLinks } from './PlayerLinks';
import { accountId, formatDecimal, rankName, type Note, type PlayerResult } from '../shared/domain';
import { api, errorMessage, Notice, number, PageHeading } from './App';

type Slot = { input: string; result?: PlayerResult; error?: string; loading?: boolean };
export function Roster({ active, notes }: { active: boolean; notes: Note[] }) {
  const [slots, setSlots] = useState<Slot[]>(Array.from({ length: 10 }, () => ({ input: '' })));
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  function update(index: number, change: Partial<Slot>) {
    setSlots((previous) => previous.map((slot, i) => (i === index ? { ...slot, ...change } : slot)));
  }
  async function loadAll() {
    setBusy(true);
    const current = ++generation.current;
    try {
      // A sequential queue keeps ten-player loading within the public API budget.
      for (const [index, slot] of slots.entries()) {
        if (current !== generation.current) break;
        if (!slot.input.trim()) continue;
        update(index, { loading: true, error: undefined, result: undefined });
        try {
          const result = await api.getPlayer(accountId(slot.input));
          if (current === generation.current) update(index, { result, loading: false });
        } catch (e) {
          if (current === generation.current) update(index, { error: errorMessage(e), loading: false });
        }
      }
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="02 / AFTER THE DRAFT"
        title="Ten players. More context."
        description="Public history, rank, and your notes for every player in the match."
      />
      <Notice>
        Enter the Dota ID or SteamID64 of each player to load a roster manually. Empty slots are skipped; loading ten
        profiles may take about a minute.
      </Notice>
      <div className="roster-toolbar">
        <span className="muted">
          <Users size={16} /> {slots.filter((slot) => slot.input.trim()).length} of 10 players
        </span>
        <div className="button-row">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              generation.current++;
              setSlots(Array.from({ length: 10 }, () => ({ input: '' })));
            }}
          >
            Clear roster
          </button>
          <button
            className="primary"
            disabled={busy || !slots.some((slot) => slot.input.trim())}
            onClick={() => void loadAll()}
          >
            {busy ? 'Loading players…' : 'Load statistics'}
          </button>
        </div>
      </div>
      <div className="roster-grid">
        {['Radiant', 'Dire'].map((team, teamIndex) => (
          <section key={team}>
            <h2 className={`team-label ${teamIndex ? 'dire' : ''}`}>
              <span className={`dot ${teamIndex ? 'red' : 'online'}`} />
              {team}
            </h2>
            {slots.slice(teamIndex * 5, teamIndex * 5 + 5).map((slot, offset) => {
              const index = teamIndex * 5 + offset;
              const data = slot.result?.snapshot;
              const total = data ? data.wl.win + data.wl.lose : 0;
              const note = notes.find((note) => note.accountId === data?.accountId);
              return (
                <article className="player-card" key={index}>
                  <div className="player-card-input">
                    <span className="slot-number">{String(index + 1).padStart(2, '0')}</span>
                    <input
                      aria-label={`${team} player ${offset + 1}`}
                      placeholder={`Dota ID · player ${offset + 1}`}
                      value={slot.input}
                      disabled={busy}
                      onChange={(e) => update(index, { input: e.target.value, result: undefined, error: undefined })}
                    />
                  </div>
                  {slot.loading && <p className="muted">Requesting profile…</p>}
                  {slot.error && (
                    <p role="alert" className="error-text">
                      {slot.error}
                    </p>
                  )}
                  {data && (
                    <div className="player-card-stats">
                      <div className="section-title">
                        <b>
                          <CountryFlag code={data.profile.profile?.loccountrycode} source="OpenDota" />
                          {data.profile.profile?.personaname || `Player ${data.accountId}`}
                        </b>
                        <PlayerLinks id={data.accountId} />
                      </div>
                      <div className="player-metrics">
                        <span>{rankName(data.profile.rank_tier)}</span>
                        <span>
                          <b className="green">{total ? `${formatDecimal((data.wl.win / total) * 100)}%` : '—'}</b> wins
                        </span>
                        <span>{number(total)} matches</span>
                      </div>
                      {slot.result?.stale && <small className="amber">Cached data · may be out of date</small>}
                      {slot.result?.warning && <small className="amber">{slot.result.warning}</small>}
                      {note && <p className={`player-note tag-${note.tag}`}>{note.text}</p>}
                      {!data.matches.length && (
                        <small className="muted">History is unavailable or has not been indexed yet.</small>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        ))}
      </div>
      {!active && busy && <span className="sr-only">Roster statistics are loading in the background.</span>}
    </>
  );
}
