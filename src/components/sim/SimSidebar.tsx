import { useState, type FormEvent } from 'react';
import { api } from '../../api';
import type { CustomPassenger, ItineraryOption, PlanResponse, SimStatusResponse, SimTripSummary } from '../../../shared/sim';
import { PassengerEditor } from '../passengers/PassengerEditor';
import { PassengerModal } from '../passengers/PassengerModal';
import { ItineraryCard } from './ItineraryCard';
import { fmtMinutes, localStamp, timeAt } from '../../lib/time';
import { serverNow } from '../../api';
import { useNow } from '../../hooks/useNow';

interface Props {
  open: boolean;
  onToggle: () => void;
  status: SimStatusResponse | null;
  onChanged: () => void;
  /** Select a flight on the map (and fly to it). */
  onSelectFlight: (id: string) => void;
}

const PRESETS = [1, 10, 100, 1000];

const STATUS_LABEL: Record<SimTripSummary['status'], string> = {
  scheduled: 'Boarding',
  taxiing: 'Taxiing',
  flying: 'In flight',
  layover: 'Connecting',
};

function tripRoute(t: SimTripSummary): string {
  return [t.legs[0].from, ...t.legs.map((l) => l.to)].join(' → ');
}

export function SimSidebar({ open, onToggle, status, onChanged, onSelectFlight }: Props) {
  const now = useNow(5000);
  const [query, setQuery] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [count, setCount] = useState(1);
  const [groupSize, setGroupSize] = useState(1);
  const [custom, setCustom] = useState<Record<string, CustomPassenger[]>>({});
  const [editing, setEditing] = useState<ItineraryOption | null>(null);
  const [manifestFor, setManifestFor] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const announce = (trip: SimTripSummary) => {
    const lastLeg = trip.legs[trip.legs.length - 1];
    setMessage({
      kind: 'ok',
      text: `Sent ${[...new Set(trip.legs.map((l) => l.flightNumber))].join(' + ')} · ${tripRoute(trip)} · arrives in ${fmtMinutes((lastLeg.arriveAt - serverNow()) / 60_000)}`,
    });
    onSelectFlight(trip.legs[0].flightId);
    onChanged();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      if (advanced) {
        const res = await api.sim.plan(query, true, groupSize);
        setPlan(res);
        setCustom({});
        if (res.error) setMessage({ kind: 'error', text: res.error });
      } else {
        setPlan(null);
        const res = await api.sim.send(query);
        if (res.trip) announce(res.trip);
        else setMessage({ kind: 'error', text: res.plan.error ?? 'No route found.' });
      }
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const fly = async (optionId: string) => {
    setBusy(true);
    try {
      const { trip } = await api.sim.book(optionId, custom[optionId] ?? []);
      setPlan(null);
      announce(trip);
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const spawn = async () => {
    setBusy(true);
    try {
      const { created } = await api.sim.spawn(count);
      setMessage({ kind: 'ok', text: `Spawned ${created.toLocaleString()} random flight${created === 1 ? '' : 's'} — they push back within the next minute.` });
      onChanged();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      window.setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    setConfirmClear(false);
    const { removed } = await api.sim.clear();
    setMessage({ kind: 'ok', text: `Removed ${removed.toLocaleString()} flight${removed === 1 ? '' : 's'}. The flight log is kept.` });
    onChanged();
  };

  if (!open) {
    return (
      <button className="sidebar-tab glass" onClick={onToggle} title="Show the simulation panel">
        <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
        Simulation
      </button>
    );
  }

  const trips = status?.trips ?? [];
  const log = status?.log ?? [];

  return (
    <aside className="sim-sidebar glass" aria-label="Simulation">
      <div className="sim-sidebar__head">
        <div>
          <div className="sim-sidebar__title">Simulation</div>
          <div className="sim-sidebar__sub">
            {status ? `${status.activeFlights.toLocaleString()} in the air · ${status.tripCount.toLocaleString()} trip${status.tripCount === 1 ? '' : 's'}` : 'Loading…'}
          </div>
        </div>
        <button className="icon-btn" onClick={onToggle} aria-label="Hide the simulation panel" title="Hide">
          <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
      </div>

      <div className="sim-sidebar__body">
        <section className="sim-section">
          <form className="trip-form" onSubmit={submit}>
            <input
              className="trip-form__input"
              placeholder="Where to?  e.g. “Iowa to Florida”"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              spellCheck={false}
            />
            <button className="trip-form__go" type="submit" disabled={busy || !query.trim()}>
              {advanced ? 'Search' : 'Send'}
            </button>
          </form>
          <label className="toggle">
            <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
            <span className="toggle__track" />
            <span>
              Advanced mode <span className="muted">— compare routes like a booking site</span>
            </span>
          </label>
          {advanced && (
            <div className="group-size">
              <span>Passengers flying</span>
              <div className="stepper stepper--small">
                <button type="button" onClick={() => setGroupSize((n) => Math.max(1, n - 1))} aria-label="Fewer passengers">−</button>
                <input
                  type="number"
                  min={1}
                  max={5000}
                  value={groupSize}
                  onChange={(e) => setGroupSize(Math.max(1, Math.min(5000, Math.floor(Number(e.target.value) || 1))))}
                />
                <button type="button" onClick={() => setGroupSize((n) => Math.min(5000, n + 1))} aria-label="More passengers">+</button>
              </div>
            </div>
          )}
          {message && <div className={`sim-msg sim-msg--${message.kind}`}>{message.text}</div>}
          {advanced && plan && plan.options.length > 0 && (
            <div className="itins">
              <div className="itins__head">
                {plan.fromLabel} → {plan.toLabel} · {plan.options.length} options
              </div>
              {plan.options.map((o) => (
                <ItineraryCard
                  key={o.id}
                  option={o}
                  busy={busy}
                  onFly={() => fly(o.id)}
                  customCount={custom[o.id]?.length ?? 0}
                  onPassengers={() => setEditing(o)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="sim-section">
          <h3 className="section__title">Spawn random flights</h3>
          <div className="spawn">
            <div className="stepper">
              <button onClick={() => setCount((c) => Math.max(1, c - 1))} aria-label="Fewer">−</button>
              <input
                type="number"
                min={1}
                max={10000}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(10000, Math.floor(Number(e.target.value) || 1))))}
              />
              <button onClick={() => setCount((c) => Math.min(10000, c + 1))} aria-label="More">+</button>
            </div>
            <button className="btn btn--primary" onClick={spawn} disabled={busy}>
              Spawn {count.toLocaleString()}
            </button>
          </div>
          <div className="presets">
            {PRESETS.map((p) => (
              <button key={p} className={count === p ? 'is-active' : ''} onClick={() => setCount(p)}>
                {p.toLocaleString()}
              </button>
            ))}
          </div>
        </section>

        <section className="sim-section">
          <h3 className="section__title">
            Active flights
            <span className="section__meta">{status?.tripCount.toLocaleString() ?? 0}</span>
            {trips.length > 0 && (
              <button className={`link-btn${confirmClear ? ' is-danger' : ''}`} onClick={clearAll}>
                {confirmClear ? 'Click again to clear' : 'Clear all'}
              </button>
            )}
          </h3>
          {trips.length === 0 ? (
            <div className="muted empty">No flights yet — send one above or spawn some.</div>
          ) : (
            <ul className="trips">
              {trips.map((t) => {
                const leg = t.legs[t.activeLeg];
                return (
                  <li key={t.id}>
                    <button
                      className="trip"
                      onClick={() => onSelectFlight(t.activeFlightId ?? leg.flightId)}
                      title={t.activeFlightId ? 'Show on map' : 'Between flights'}
                    >
                      <div className="trip__row">
                        <span className="trip__flight">{leg.flightNumber}</span>
                        <span className="trip__route">{tripRoute(t)}</span>
                        <span className={`origin-badge${t.random ? ' is-random' : ''}`}>{t.random ? 'Random' : 'Booked'}</span>
                      </div>
                      <div className="trip__row trip__row--sub">
                        <span>{STATUS_LABEL[t.status]}</span>
                        <span>{fmtMinutes(Math.max(0, (t.finalArriveAt - now) / 60_000))} left</span>
                      </div>
                      <div className="trip__bar">
                        <div style={{ width: `${t.progress * 100}%` }} />
                      </div>
                    </button>
                  </li>
                );
              })}
              {status && status.tripCount > trips.length && <li className="muted more">+ {(status.tripCount - trips.length).toLocaleString()} more</li>}
            </ul>
          )}
        </section>

        <section className="sim-section">
          <h3 className="section__title">
            Flight log
            <span className="section__meta">{status?.logTotal.toLocaleString() ?? 0}</span>
          </h3>
          {log.length === 0 ? (
            <div className="muted empty">Landed and crashed flights will show up here.</div>
          ) : (
            <ul className="log">
              {log.map((e) => (
                <li key={e.id} className={`log__item${e.outcome === 'crashed' ? ' is-crashed' : ''}`}>
                  <div className="log__row">
                    <span className={`outcome outcome--${e.outcome}`}>{e.outcome === 'crashed' ? '💥 Crashed' : 'Landed'}</span>
                    <span className="log__time" title={`${e.toCity ?? e.to} local time: ${timeAt(e.at, null)}`}>
                      {localStamp(e.at)}
                    </span>
                  </div>
                  <div className="log__row">
                    <span className="log__flight">{e.flightNumber}</span>
                    <span className="log__route">
                      {e.from} → {e.to}
                    </span>
                    <span className="log__type">{e.aircraftType}</span>
                    <span className={`origin-badge${e.random ? ' is-random' : ''}`} title={e.random ? 'Randomly generated flight' : 'Flight you sent'}>
                      {e.random ? '🎲' : '✈'}
                    </span>
                  </div>
                  <div className="log__row log__row--sub">
                    <span className="muted">
                      {e.paxCount ?? 0} passenger{e.paxCount === 1 ? '' : 's'} {e.outcome === 'landed' ? 'delivered' : 'aboard'}
                    </span>
                    <button className="link-btn" onClick={() => setManifestFor(e.id)}>
                      Passengers
                    </button>
                  </div>
                </li>
              ))}
              {status && status.logTotal > log.length && <li className="muted more">Showing the latest {log.length} of {status.logTotal.toLocaleString()}</li>}
            </ul>
          )}
        </section>
      </div>
      {editing && (
        <PassengerEditor
          option={editing}
          initial={custom[editing.id] ?? []}
          onClose={() => setEditing(null)}
          onSave={(list) => {
            setCustom((prev) => ({ ...prev, [editing.id]: list }));
            setEditing(null);
          }}
        />
      )}
      {manifestFor && <PassengerModal load={() => api.sim.logPassengers(manifestFor)} onClose={() => setManifestFor(null)} />}
    </aside>
  );
}
