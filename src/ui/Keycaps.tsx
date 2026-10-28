import { Fragment } from 'react';

const arrow: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
};
/** A key combination as keycaps; physical codes read as the symbol on the key. */
export function Keycaps({ combo }: { combo: string }) {
  const keys = combo
    .split('+')
    .map((key) => key.trim())
    .filter(Boolean)
    .map((key) =>
      key
        .replace(/^(?:Numpad|KP_|Num\s*)(\d)$/i, 'Num $1')
        .replace(/^KP_Begin$/i, 'Num 5')
        .replace(/^Key([A-Z])$/, '$1')
        .replace(/^Digit(\d)$/, '$1')
        .replace(/^(Arrow(?:Left|Right|Up|Down))$/, (name) => arrow[name] ?? name)
        .replace(/^Ctrl$/i, 'Ctrl')
        .replace(/^Meta$/i, 'Meta'),
    );
  return (
    <span className="keycaps" aria-label={keys.join(' + ')}>
      {keys.map((key, index) => (
        <Fragment key={index}>
          {index > 0 && <span aria-hidden="true">+</span>}
          <kbd>{key}</kbd>
        </Fragment>
      ))}
    </span>
  );
}
