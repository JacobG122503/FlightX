import { useState } from 'react';
import { SIM_COLORS } from '../lib/icons';

const KEY = 'flightx:legend';

function loadHidden(): boolean {
  try {
    return localStorage.getItem(KEY) === 'hidden';
  } catch {
    return false;
  }
}

/** Key for the plane colours; collapses to a small tab. */
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
      <button className="edge-tab edge-tab--legend glass" onClick={() => toggle(false)} title="Show the colour key" aria-label="Show the colour key">
        <svg viewBox="0 0 24 24" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
      </button>
    );
  }

  return (
    <div className="legend legend--sim glass" aria-label="Plane colours">
      <div className="legend__head">
        <div className="legend__title">Planes</div>
        <button className="legend__hide" onClick={() => toggle(true)} aria-label="Hide the key" title="Hide">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <div className="legend__swatches">
        <span><i style={{ background: SIM_COLORS.mine }} /> Yours</span>
        <span><i style={{ background: SIM_COLORS.random }} /> Random</span>
        <span><i style={{ background: SIM_COLORS.ground }} /> On ground</span>
      </div>
    </div>
  );
}
