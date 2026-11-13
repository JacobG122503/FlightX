import { useEffect, useState } from 'react';
import type { CustomPlaneChoice, ItineraryOption } from '../../../shared/sim';
import { ItineraryCard } from './ItineraryCard';

type FuelMode = 'realistic' | 'unlimited';

interface Props {
  choices: CustomPlaneChoice[];
  busy: boolean;
  onFly: (option: ItineraryOption) => void;
}

/** The fun planes, in a dropdown that starts closed for every search; each card has its own fuel switch. */
export function CustomPlanes({ choices, busy, onFly }: Props) {
  const [open, setOpen] = useState(false);
  /** Fuel setting per plane (Realistic unless switched). */
  const [fuel, setFuel] = useState<Record<string, FuelMode>>({});

  // A new search starts over: dropdown closed, every plane back on Realistic.
  useEffect(() => {
    setOpen(false);
    setFuel({});
  }, [choices]);

  if (!choices.length) return null;

  return (
    <div className="itins custom-planes">
      <button className="section-toggle custom-planes__toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <svg className={`chev${open ? ' is-open' : ''}`} viewBox="0 0 24 24" aria-hidden>
          <path d="M9 6l6 6-6 6" />
        </svg>
        Custom planes
        <span className="section__meta">{choices.length}</span>
      </button>
      {open &&
        choices.map((c) => {
          const mode = c.fuelApplies ? (fuel[c.key] ?? 'realistic') : 'realistic';
          const option = mode === 'realistic' ? c.realistic : c.unlimited;
          return (
            <div key={c.key} className="custom-plane">
              <div className="custom-plane__head">
                <div className="custom-plane__title">
                  <strong>{c.name}</strong>
                  <span className="muted">{c.summary}</span>
                </div>
                <div
                  className={`seg custom-plane__fuel${c.fuelApplies ? '' : ' is-disabled'}`}
                  role="radiogroup"
                  aria-label={`Fuel for ${c.name}`}
                  title={c.fuelApplies ? 'Fuel' : 'No fuel needed'}
                >
                  {(['realistic', 'unlimited'] as const).map((f) => (
                    <button
                      key={f}
                      role="radio"
                      aria-checked={c.fuelApplies && mode === f}
                      disabled={!c.fuelApplies}
                      className={c.fuelApplies && mode === f ? 'is-active' : ''}
                      onClick={() => setFuel((prev) => ({ ...prev, [c.key]: f }))}
                    >
                      {f === 'realistic' ? 'Realistic' : 'Unlimited'}
                    </button>
                  ))}
                </div>
              </div>
              {option ? <ItineraryCard option={option} busy={busy} onFly={() => onFly(option)} /> : <div className="custom-plane__na">{c.unavailable}</div>}
            </div>
          );
        })}
    </div>
  );
}
