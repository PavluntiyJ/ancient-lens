import { setEncounterSound, useEncounterSound } from '../preferences';
import { playChime } from '../sound';

export function SoundSettings() {
  const encounterSound = useEncounterSound();
  return (
    <section className="panel display-settings" id="settings-sound">
      <h2>Sound</h2>
      <label>
        <input type="checkbox" checked={encounterSound} onChange={(e) => setEncounterSound(e.target.checked)} />
        Chime for players with a note
      </label>
      <p className="fine-print">
        Plays when a match you play or watch has someone you wrote a note about, once per player; a lower chime marks a
        "Watch out" note. Notes are kept on this computer by Dota ID, so private profiles count too.
      </p>
      <button type="button" className="secondary" onClick={() => playChime('note')}>
        Play note
      </button>
      <button type="button" className="secondary" onClick={() => playChime('avoid')}>
        Play watch out
      </button>
    </section>
  );
}
