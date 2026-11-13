import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api';
import type { LogFlightDetails } from '../../../shared/sim';
import { airportTimeTip, fmtMinutes, localStampTz } from '../../lib/time';
import { fmtMiFromNm } from '../../lib/format';

interface Props {
  entryId: string;
  onClose: () => void;
}

/** Details of a finished flight from the flight log. */
export function LogFlightModal({ entryId, onClose }: Props) {
  const [details, setDetails] = useState<LogFlightDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.sim.logDetails(entryId).then(setDetails, (e: Error) => setError(e.message));
  }, [entryId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const e = details?.entry;
  const city = (a: LogFlightDetails['from'], code: string) => a?.city?.split(',')[0] ?? code;

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div className="modal modal--log glass" role="dialog" aria-label="Flight details">
        <div className="modal__head">
          <div>
            <div className="modal__title">{e ? `${e.flightNumber} · ${e.from} → ${e.to}` : 'Flight details'}</div>
            {details && (
              <div className="modal__sub">
                {details.airline} · {details.aircraftName} · {e!.reg}
              </div>
            )}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        {error && <div className="sim-msg sim-msg--error">{error}</div>}
        {!details && !error && <div className="muted modal__loading">Loading…</div>}
        {details && e && (
          <div className="modal__body log-details">
            <div className="log-details__badges">
              <span className={`outcome outcome--${e.outcome}`}>{e.outcome === 'crashed' ? '💥 Crashed' : 'Landed'}</span>
              <span className={`origin-badge${e.random ? ' is-random' : ' is-mine'}`}>{e.random ? 'Random' : 'Yours'}</span>
              {e.legCount > 1 && <span className="muted">Leg {e.legIndex + 1} of {e.legCount}</span>}
            </div>

            <div className="log-details__route">
              <div>
                <div className="route__code">{e.from}</div>
                <div className="muted">{details.from?.name ?? e.fromCity}</div>
              </div>
              <div className="log-details__arrow">→</div>
              <div className="route__end--right">
                <div className="route__code">{e.to}</div>
                <div className="muted">{details.to?.name ?? e.toCity}</div>
              </div>
            </div>

            <dl className="grid">
              <div className="row">
                <dt>Took off</dt>
                <dd data-tip={airportTimeTip(e.departedAt, details.from?.tz ?? null, city(details.from, e.from))}>{localStampTz(e.departedAt)}</dd>
              </div>
              <div className="row">
                <dt>{e.outcome === 'crashed' ? 'Crashed' : 'Landed'}</dt>
                <dd data-tip={airportTimeTip(e.at, details.to?.tz ?? null, city(details.to, e.to))}>{localStampTz(e.at)}</dd>
              </div>
              <div className="row">
                <dt>Flight time</dt>
                <dd>{fmtMinutes(Math.max(0, (e.at - e.departedAt) / 60_000))}</dd>
              </div>
              <div className="row">
                <dt>Distance</dt>
                <dd>{details.distanceNm != null ? fmtMiFromNm(details.distanceNm) : '—'}</dd>
              </div>
              <div className="row">
                <dt>Passengers</dt>
                <dd>
                  {(e.paxCount ?? 0).toLocaleString()} {e.outcome === 'landed' ? 'delivered' : 'aboard'}
                </dd>
              </div>
              <div className="row">
                <dt>Callsign</dt>
                <dd className="mono">{e.callsign}</dd>
              </div>
            </dl>

            <div className="pax-editor__actions">
              <button className="btn btn--primary" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
