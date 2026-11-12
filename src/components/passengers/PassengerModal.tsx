import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import type { Passenger, PassengerManifest } from '../../../shared/sim';
import { SeatMapView } from './SeatMapView';

interface Props {
  load: () => Promise<PassengerManifest>;
  onClose: () => void;
}

/** Everyone on a flight: seat map (click a seat) or a list. */
export function PassengerModal({ load, onClose }: Props) {
  const [manifest, setManifest] = useState<PassengerManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'map' | 'list'>('map');
  const [selected, setSelected] = useState<string | null>(null);

  // Load once when opened.
  const [loader] = useState(() => load);
  useEffect(() => {
    loader().then(setManifest, (e: Error) => setError(e.message));
  }, [loader]);

  // Escape closes only this dialog: catch it first (capture phase) and stop it there.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const bySeat = useMemo(() => new Map((manifest?.passengers ?? []).map((p) => [p.seat, p])), [manifest]);
  const picked: Passenger | undefined = selected ? bySeat.get(selected) : undefined;

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal glass" role="dialog" aria-label="Passengers">
        <div className="modal__head">
          <div>
            <div className="modal__title">{manifest ? `${manifest.flightNumber} · ${manifest.from} → ${manifest.to}` : 'Passengers'}</div>
            {manifest && (
              <div className="modal__sub">
                {manifest.aircraftName} · {manifest.passengers.length} of {manifest.seatMap.capacity} seats filled
                {manifest.delivered === true && ' · all delivered'}
                {manifest.delivered === false && ' · flight crashed — did not arrive'}
              </div>
            )}
          </div>
          <div className="seg">
            <button className={view === 'map' ? 'is-active' : ''} onClick={() => setView('map')}>Seat map</button>
            <button className={view === 'list' ? 'is-active' : ''} onClick={() => setView('list')}>List</button>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        {error && <div className="sim-msg sim-msg--error">{error}</div>}
        {!manifest && !error && <div className="muted modal__loading">Loading passengers…</div>}
        {manifest && view === 'map' && (
          <div className="modal__body modal__body--split">
            <SeatMapView
              map={manifest.seatMap}
              seatClass={(s) => {
                const p = bySeat.get(s);
                return [p ? (p.custom ? 'is-custom' : 'is-taken') : '', s === selected ? 'is-selected' : ''].join(' ');
              }}
              onSeat={setSelected}
              title={(s) => {
                const p = bySeat.get(s);
                return p ? `${s} · ${p.name}, ${p.age}` : `${s} · empty`;
              }}
            />
            <div className="pax-card">
              {picked ? (
                <>
                  <div className="pax-card__seat">Seat {picked.seat}</div>
                  <div className="pax-card__name">{picked.name}</div>
                  <dl className="pax-card__facts">
                    <dt>Age</dt>
                    <dd>{picked.age}</dd>
                    <dt>Nationality</dt>
                    <dd>{picked.nationalityName}</dd>
                    <dt>Cabin</dt>
                    <dd>{picked.cabin}</dd>
                  </dl>
                  {picked.custom && <div className="origin-badge">Added by you</div>}
                </>
              ) : selected ? (
                <div className="muted">Seat {selected} is empty.</div>
              ) : (
                <div className="muted">Click a seat to see who’s sitting there.</div>
              )}
              <div className="pax-legend">
                <span><i className="seat is-taken" /> Passenger</span>
                <span><i className="seat is-custom" /> Yours</span>
                <span><i className="seat" /> Empty</span>
              </div>
            </div>
          </div>
        )}
        {manifest && view === 'list' && (
          <div className="modal__body">
            <table className="pax-table">
              <thead>
                <tr><th>Seat</th><th>Name</th><th>Age</th><th>Nationality</th><th>Cabin</th></tr>
              </thead>
              <tbody>
                {manifest.passengers.map((p) => (
                  <tr key={p.seat} className={p.custom ? 'is-custom' : ''}>
                    <td className="mono">{p.seat}</td>
                    <td>{p.name}</td>
                    <td>{p.age}</td>
                    <td>{p.nationalityName}</td>
                    <td>{p.cabin}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
