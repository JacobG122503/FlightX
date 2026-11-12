import { ALTITUDE_GRADIENT, GROUND_COLOR } from '../lib/altitude';

const MAX_FT = 45_000;
const TICKS: [number, string][] = [
  [0, '0'],
  [10_000, '10k'],
  [20_000, '20k'],
  [30_000, '30k'],
  [40_000, '40k'],
];

export function Legend() {
  return (
    <div className="legend glass" aria-label="Altitude colour legend">
      <div className="legend__title">Altitude · ft</div>
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
