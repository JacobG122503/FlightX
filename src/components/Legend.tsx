import { useState } from 'react';
import { ALTITUDE_GRADIENT, GROUND_COLOR } from '../lib/altitude';

const MAX_FT = 45_000;
const TICKS: [number, string][] = [
  [0, '0'],
  [10_000, '10k'],
  [20_000, '20k'],
  [30_000, '30k'],
  [40_000, '40k'],
];
const KEY = 'flightx:legend';

function loadHidden(): boolean {
  try {
    return localStorage.getItem(KEY) === 'hidden';
  } catch {
    return false;
  }
}

export function Legend() {
  const [hidden, setHidden] = useState(loadHidden);
  const toggle = (next: boolean) => {
    setHidden(next);
    try {
      localStorage.setItem(KEY, next ? 'hidden' : 'shown');
    } catch {
      /* ignore */
    }
  };

  if (hidden) {
    return (
      <button className="edge-tab edge-tab--legend glass" onClick={() => toggle(false)} title="Show the altitude key" aria-label="Show the altitude key">
        <svg viewBox="0 0 24 24" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
      </button>
    );
  }

  return (
    <div className="legend glass" aria-label="Altitude colour legend">
      <div className="legend__head">
        <div className="legend__title">Altitude · ft</div>
        <button className="legend__hide" onClick={() => toggle(true)} aria-label="Hide the altitude key" title="Hide">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <div className="legend__row">
        <div className="legend__ground-wrap">
          <span className="legend__ground" style={{ background: GROUND_COLOR }} />
          <span className="legend__tick legend__tick--static">GND</span>
        </div>
        <div className="legend__scale">
          <div className="legend__bar" style={{ background: ALTITUDE_GRADIENT }} />
          <div className="legend__ticks">
            {TICKS.map(([ft, label]) => (
              <span key={ft} className="legend__tick" style={{ left: `${(ft / MAX_FT) * 100}%` }}>
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
