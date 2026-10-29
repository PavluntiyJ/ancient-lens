import { setEncounterSound, setEncounterVolume, useEncounterSound, useEncounterVolume } from '../preferences';
import { playChime } from '../sound';

export function SoundSettings() {
  const encounterSound = useEncounterSound();
  const volume = useEncounterVolume();
  return (
    <section className="panel display-settings" id="settings-sound">
      <h2>Sound</h2>
      <label>
        <input type="checkbox" checked={encounterSound} onChange={(e) => setEncounterSound(e.target.checked)} />
        Chime for players with a note
      </label>
      <p className="fine-print">
        Plays two soft notes at 30% of this volume when a match you play or watch has someone you wrote a note about,
        once per player. Notes are kept on this computer by Dota ID, so private profiles count too.
      </p>
      <div className={`synergy-setting${encounterSound ? '' : ' disabled'}`}>
        <label htmlFor="encounter-volume">Chime volume: {volume}%</label>
        <input
          id="encounter-volume"
          type="range"
          min="0"
          max="100"
          step="5"
          aria-label="Chime volume"
          value={volume}
          disabled={!encounterSound}
          onChange={(event) => setEncounterVolume(Number(event.target.value))}
          // The new level is heard when the slider is let go, not at every step of a drag.
          onPointerUp={() => playChime('note')}
          onKeyUp={() => playChime('note')}
        />
      </div>
      <button type="button" className="secondary" onClick={() => playChime('note')}>
        Play note
      </button>
    </section>
  );
}
