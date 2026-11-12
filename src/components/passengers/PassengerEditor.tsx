import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../../api';
import type { CustomPassenger, ItineraryOption, SeatMap } from '../../../shared/sim';
import { SeatMapView } from './SeatMapView';

interface Props {
  option: ItineraryOption;
  initial: CustomPassenger[];
  onSave: (passengers: CustomPassenger[]) => void;
  onClose: () => void;
}

/** Add your own passengers to a booking and choose their seats. */
export function PassengerEditor({ option, initial, onSave, onClose }: Props) {
  const leg = option.legs[0];
  const [map, setMap] = useState<SeatMap | null>(null);
  const [list, setList] = useState<CustomPassenger[]>(initial);
  const [active, setActive] = useState<number | null>(initial.length ? 0 : null);
  const [name, setName] = useState('');
  const [age, setAge] = useState('');

  useEffect(() => {
    void api.sim.seatMap(leg.aircraftType, option.kind === 'charter').then(setMap);
  }, [leg.aircraftType, option.kind]);

  // Escape closes only this dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const seatOwner = useMemo(() => new Map(list.map((p, i) => [p.seat, i])), [list]);
  const groupSize = Math.max(option.passengers, list.length);
  const perPlane = map ? map.capacity * (option.kind === 'charter' ? option.aircraftCount : 1) : Infinity;

  const add = (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim() || list.length >= perPlane) return;
    const next = [...list, { name: name.trim(), age: Math.max(0, Math.min(120, Number(age) || 30)), seat: '' }];
    setList(next);
    setActive(next.length - 1);
    setName('');
    setAge('');
  };

  const randomFill = async () => {
    const p = await api.sim.randomPerson();
    setName(p.name);
    setAge(String(p.age));
  };

  const clickSeat = (seat: string) => {
    const owner = seatOwner.get(seat);
    if (owner != null) {
      setActive(owner);
      return;
    }
    if (active == null) return;
    setList((prev) => prev.map((p, i) => (i === active ? { ...p, seat } : p)));
    // Move on to the next passenger without a seat.
    const nextUnplaced = list.findIndex((p, i) => i !== active && !p.seat);
    setActive(nextUnplaced >= 0 ? nextUnplaced : active);
  };

  const remove = (i: number) => {
    setList((prev) => prev.filter((_, j) => j !== i));
    setActive(null);
  };

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal glass" role="dialog" aria-label="Add passengers">
        <div className="modal__head">
          <div>
            <div className="modal__title">Your passengers</div>
            <div className="modal__sub">
              {leg.aircraftName}
              {option.aircraftCount > 1 ? ` × ${option.aircraftCount}` : ''} · {leg.from.iata} → {option.legs[option.legs.length - 1].to.iata}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div className="modal__body modal__body--split">
          {map ? (
            <SeatMapView
              map={map}
              seatClass={(s) => {
                const owner = seatOwner.get(s);
                return owner == null ? 'is-free' : owner === active ? 'is-custom is-selected' : 'is-custom';
              }}
              onSeat={clickSeat}
              title={(s) => {
                const owner = seatOwner.get(s);
                return owner == null ? `${s} · free` : `${s} · ${list[owner].name}`;
              }}
            />
          ) : (
            <div className="muted">Loading seat map…</div>
          )}
          <div className="pax-editor">
            <form className="pax-editor__form" onSubmit={add}>
              <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
              <input placeholder="Age" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, ''))} maxLength={3} className="age" />
              <button type="button" className="icon-btn" title="Random person" onClick={randomFill}>
                🎲
              </button>
              <button type="submit" className="btn btn--primary" disabled={!name.trim()}>
                Add
              </button>
            </form>
            <div className="muted pax-editor__hint">
              {active != null ? `Click a seat for ${list[active]?.name}.` : 'Add a passenger, then click a seat to place them.'}
            </div>
            <ul className="pax-editor__list">
              {list.map((p, i) => (
                <li key={i} className={i === active ? 'is-active' : ''} onClick={() => setActive(i)}>
                  <span className="mono">{p.seat || '—'}</span>
                  <span className="pax-editor__name">{p.name}</span>
                  <span className="muted">{p.age}</span>
                  <button
                    className="link-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(i);
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <div className="pax-editor__summary">
              {list.length} of {groupSize.toLocaleString()} travellers named
              {option.kind === 'charter'
                ? ` — the other ${Math.max(0, groupSize - list.length).toLocaleString()} are filled with random passengers.`
                : ' — the rest of the plane fills with random passengers.'}{' '}
              Unseated passengers get a seat automatically.
            </div>
            <div className="pax-editor__actions">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn btn--primary" onClick={() => onSave(list)}>
                Save {list.length} passenger{list.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
