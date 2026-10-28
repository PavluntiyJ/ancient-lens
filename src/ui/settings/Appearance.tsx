import { defaultDisplay, displayScales, setDisplaySettings, useDisplaySettings } from '../preferences';

export function AppearanceSettings() {
  const display = useDisplaySettings();
  return (
    <section className="panel display-settings" id="settings-appearance">
      <h2>Appearance</h2>{' '}
      <div className="scale-setting">
        <span id="scale-label">Interface scale</span>
        <div className="scale-options" role="group" aria-labelledby="scale-label">
          {displayScales.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={display.scale === value}
              onClick={() => setDisplaySettings({ scale: value })}
            >
              {value}%
            </button>
          ))}
        </div>
      </div>
      <p className="fine-print">Scales the whole window. The match screen still shrinks itself to fit, down to 90%.</p>
      <label>
        <input
          type="checkbox"
          checked={display.compact}
          onChange={(e) => setDisplaySettings({ compact: e.target.checked })}
        />
        Compact rows
      </label>
      <p className="fine-print">Shorter roster rows, so more fits on a small screen.</p>
      <fieldset>
        <legend>Match table columns</legend>
        {(
          [
            ['rank', 'Rank'],
            ['totals', 'Total matches'],
            ['frequent', 'Frequent heroes'],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={display[key]}
              onChange={(e) => setDisplaySettings({ [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
        <p className="fine-print">Hidden columns only leave the roster table; their data still loads.</p>
      </fieldset>
      <button className="secondary" onClick={() => setDisplaySettings(defaultDisplay)}>
        Reset appearance
      </button>
    </section>
  );
}
