import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api';
import type { MissedSummary } from '../../../shared/sim';
import { fmtMinutes, localStampTz, timeTz } from '../../lib/time';

const AWAY_THRESHOLD_MS = 5 * 60_000;
/** Shown at most once per launch (even if you switch modes and back). */
let checkedThisLaunch = false;

interface Props {
  onSelectFlight: (id: string) => void;
}

/** "Things you missed": what happened in the simulation while FlightX was closed. */
export function MissedModal({ onSelectFlight }: Props) {
  const [summary, setSummary] = useState<MissedSummary | null>(null);

  useEffect(() => {
    if (checkedThisLaunch) return;
    checkedThisLaunch = true;
    api.sim
      .missed()
      .then((m) => {
        if (m.awayMs >= AWAY_THRESHOLD_MS && (m.landed > 0 || m.stillFlyingTotal > 0)) setSummary(m);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!summary) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setSummary(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [summary]);

  if (!summary) return null;
  const close = () => setSummary(null);
  const yours = summary.landed - summary.randomLanded;

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal modal--missed glass" role="dialog" aria-label="Things you missed">
        <div className="modal__head">
          <div>
            <div className="modal__title">Things you missed</div>
            <div className="modal__sub">
              You were away {fmtMinutes(summary.awayMs / 60_000)}
              {summary.since && ` — since ${localStampTz(summary.since)}`}
            </div>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <svg viewBox="0 0 24 24">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="modal__body">
          <div className="missed-stats">
            <div>
              <strong>{summary.landed.toLocaleString()}</strong>
              <span>flights landed</span>
            </div>
            <div>
              <strong>{yours.toLocaleString()}</strong>
              <span>of them yours</span>
            </div>
            <div>
              <strong>{summary.passengersDelivered.toLocaleString()}</strong>
              <span>passengers delivered</span>
            </div>
            <div>
              <strong>{summary.stillFlyingTotal.toLocaleString()}</strong>
              <span>
                still flying · {summary.stillFlyingYours.toLocaleString()} yours
              </span>
            </div>
          </div>

          {summary.bookedLanded.length > 0 && (
            <>
              <h3 className="section__title">Your flights that landed</h3>
              <ul className="missed-list">
                {summary.bookedLanded.map((e) => (
                  <li key={e.id}>
                    <span className="mono">{e.flightNumber}</span>
                    <span>
                      <span className="code" data-tip={e.fromCity ?? undefined}>{e.from}</span> →{' '}
                      <span className="code" data-tip={e.toCity ?? undefined}>{e.to}</span>
                    </span>
                    <span className="muted">{e.paxCount} pax</span>
                    <span className="missed-list__time">Landed {timeTz(e.at)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {summary.stillFlying.length > 0 && (
            <>
              <h3 className="section__title">Still on the way</h3>
              <ul className="missed-list">
                {summary.stillFlying.map((t) => (
                  <li
                    key={t.id}
                    className={`is-clickable ${t.random ? 'is-random' : 'is-mine'}`}
                    onClick={() => {
                      onSelectFlight(t.activeFlightId ?? t.legs[t.activeLeg].flightId);
                      close();
                    }}
                  >
                    <span className="mono">{t.legs[t.activeLeg].flightNumber}</span>
                    <span className="missed-list__route">
                      {[t.legs[0].from, ...t.legs.map((l) => l.to)].join(' → ')}
                      <span className={`origin-badge${t.random ? ' is-random' : ' is-mine'}`}>{t.random ? 'Random' : 'Yours'}</span>
                    </span>
                    <span className="trip__bar missed-list__bar">
                      <div style={{ width: `${t.progress * 100}%` }} />
                    </span>
                    <span className="missed-list__time">{fmtMinutes(Math.max(0, (t.finalArriveAt - Date.now()) / 60_000))} left</span>
                  </li>
                ))}
              </ul>
              {summary.stillFlyingTotal > summary.stillFlying.length && (
                <p className="muted missed-note">
                  + {(summary.stillFlyingTotal - summary.stillFlying.length).toLocaleString()} more — see Active flights in the sidebar.
                </p>
              )}
            </>
          )}

          {summary.randomLanded > 0 && (
            <p className="muted missed-note">
              Plus {summary.randomLanded.toLocaleString()} random flight{summary.randomLanded === 1 ? '' : 's'} landed — see the flight log for all of them.
            </p>
          )}
          <div className="pax-editor__actions">
            <button className="btn btn--primary" onClick={close}>
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
