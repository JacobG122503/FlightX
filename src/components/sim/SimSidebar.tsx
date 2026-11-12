import { useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api, serverNow } from '../../api';
import type { CustomPassenger, ItineraryOption, PlanResponse, SimStatusResponse, SimTripSummary, TripView } from '../../../shared/sim';
import { ItineraryCard } from './ItineraryCard';
import { PassengerEditor } from '../passengers/PassengerEditor';
import { PassengerModal } from '../passengers/PassengerModal';
import { LogFlightModal } from './LogFlightModal';
import { airportTimeTip, fmtMinutes, localStampTz } from '../../lib/time';
import { useNow } from '../../hooks/useNow';

interface Props {
  open: boolean;
  onToggle: () => void;
  status: SimStatusResponse | null;
  onChanged: () => void;
  /** Select a flight on the map (and fly to it). */
  onSelectFlight: (id: string) => void;
  view: TripView;
  onView: (view: TripView) => void;
}

const PRESETS = [1, 10, 100, 1000];

const STATUS_LABEL: Record<SimTripSummary['status'], string> = {
  scheduled: 'Boarding',
  taxiing: 'Taxiing',
  flying: 'In flight',
  layover: 'Connecting',
};

const VIEW_LABEL: Record<TripView, string> = {
  newest: 'Newest first',
  booked: 'Booked by me',
  random: 'Random only',
  'left-asc': 'Least time left',
  'left-desc': 'Most time left',
};

const SECTIONS_KEY = 'flightx:sections';
function loadSections(): { active: boolean; log: boolean } {
  try {
    return { active: true, log: true, ...JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}') };
  } catch {
    return { active: true, log: true };
  }
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`chev${open ? ' is-open' : ''}`} viewBox="0 0 24 24" aria-hidden>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function SimSidebar({ open, onToggle, status, onChanged, onSelectFlight, view, onView }: Props) {
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
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [sections, setSections] = useState(loadSections);

  const toggleSection = (key: 'active' | 'log') =>
    setSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(SECTIONS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  const airports = status?.airports ?? {};
  /** An airport code with a hover popup saying where it is. */
  const code = (iata: string): ReactNode => {
    const a = airports[iata];
    return (
      <span className="code" data-tip={a ? `${a.name} — ${a.place}` : undefined}>
        {iata}
      </span>
    );
  };
  const route = (codes: string[]): ReactNode =>
    codes.map((c, i) => (
      <span key={i}>
        {i > 0 && ' → '}
        {code(c)}
      </span>
    ));

  /** After a flight starts: report it and reset the form for the next one. */
  const announce = (trip: SimTripSummary) => {
    const lastLeg = trip.legs[trip.legs.length - 1];
    setMessage({
      kind: 'ok',
      text: `Sent ${[...new Set(trip.legs.map((l) => l.flightNumber))].join(' + ')} · ${[trip.legs[0].from, ...trip.legs.map((l) => l.to)].join(' → ')} · arrives in ${fmtMinutes((lastLeg.arriveAt - serverNow()) / 60_000)}`,
    });
    setQuery('');
    setPlan(null);
    setGroupSize(1);
    setCustom({});
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
      setCount(1); // reset for next time, like the trip form after a flight starts
      onChanged();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    setConfirmClear(false);
    const { removed } = await api.sim.clear();
    setMessage({ kind: 'ok', text: `Removed ${removed.toLocaleString()} flight${removed === 1 ? '' : 's'}. The flight log is kept.` });
    onChanged();
  };

  if (!open) {
    return (
      <button className="edge-tab edge-tab--sidebar glass" onClick={onToggle} title="Show the simulation panel" aria-label="Show the simulation panel">
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M9 6l6 6-6 6" />
        </svg>
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
            {status
              ? `${status.activeFlights.toLocaleString()} in the air · ${status.tripCount.toLocaleString()} trip${status.tripCount === 1 ? '' : 's'}`
              : 'Loading…'}
          </div>
        </div>
        <button className="icon-btn" onClick={onToggle} aria-label="Hide the simulation panel" title="Hide">
          <svg viewBox="0 0 24 24">
            <path d="M15 6l-6 6 6 6" />
          </svg>
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
                <button type="button" onClick={() => setGroupSize((n) => Math.max(1, n - 1))} aria-label="Fewer passengers">
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  max={5000}
                  value={groupSize}
                  onChange={(e) => setGroupSize(Math.max(1, Math.min(5000, Math.floor(Number(e.target.value) || 1))))}
                />
                <button type="button" onClick={() => setGroupSize((n) => Math.min(5000, n + 1))} aria-label="More passengers">
                  +
                </button>
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
              <button onClick={() => setCount((c) => Math.max(1, c - 1))} aria-label="Fewer">
                −
              </button>
              <input
                type="number"
                min={1}
                max={10000}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(10000, Math.floor(Number(e.target.value) || 1))))}
              />
              <button onClick={() => setCount((c) => Math.min(10000, c + 1))} aria-label="More">
                +
              </button>
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
          <div className="section-head">
            <button className="section-toggle" onClick={() => toggleSection('active')} aria-expanded={sections.active}>
              <Chevron open={sections.active} />
              Active flights
              <span className="section__meta">{status?.tripCount.toLocaleString() ?? 0}</span>
            </button>
            {sections.active && (
              <select className="view-select" value={view} onChange={(e) => onView(e.target.value as TripView)} aria-label="Sort active flights">
                {(Object.keys(VIEW_LABEL) as TripView[]).map((v) => (
                  <option key={v} value={v}>
                    {VIEW_LABEL[v]}
                  </option>
                ))}
              </select>
            )}
          </div>
          {sections.active &&
            (trips.length === 0 ? (
              <div className="muted empty">
                {view === 'booked' ? 'None of your flights are active.' : view === 'random' ? 'No random flights are active.' : 'No flights yet — send one above or spawn some.'}
              </div>
            ) : (
              <>
                <ul className="trips">
                  {trips.map((t) => {
                    const leg = t.legs[t.activeLeg];
                    return (
                      <li key={t.id}>
                        <div
                          className="trip"
                          role="button"
                          tabIndex={0}
                          onClick={() => onSelectFlight(t.activeFlightId ?? leg.flightId)}
                          onKeyDown={(e) => e.key === 'Enter' && onSelectFlight(t.activeFlightId ?? leg.flightId)}
                        >
                          <div className="trip__row">
                            <span className="trip__flight">{leg.flightNumber}</span>
                            <span className="trip__route">{route([t.legs[0].from, ...t.legs.map((l) => l.to)])}</span>
                            <span className={`origin-badge${t.random ? ' is-random' : ' is-mine'}`}>{t.random ? 'Random' : 'Yours'}</span>
                          </div>
                          <div className="trip__row trip__row--sub">
                            <span>{STATUS_LABEL[t.status]}</span>
                            <span>{fmtMinutes(Math.max(0, (t.finalArriveAt - now) / 60_000))} left</span>
                          </div>
                          <div className="trip__bar">
                            <div style={{ width: `${t.progress * 100}%` }} />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                  {status && status.tripCount > trips.length && view === 'newest' && (
                    <li className="muted more">+ {(status.tripCount - trips.length).toLocaleString()} more</li>
                  )}
                </ul>
                <button className="link-btn link-btn--danger" onClick={() => setConfirmClear(true)}>
                  Clear all flights…
                </button>
              </>
            ))}
        </section>

        <section className="sim-section">
          <div className="section-head">
            <button className="section-toggle" onClick={() => toggleSection('log')} aria-expanded={sections.log}>
              <Chevron open={sections.log} />
              Flight log
              <span className="section__meta">{status?.logTotal.toLocaleString() ?? 0}</span>
            </button>
          </div>
          {sections.log &&
            (log.length === 0 ? (
              <div className="muted empty">Landed and crashed flights will show up here.</div>
            ) : (
              <ul className="log">
                {log.map((e) => (
                  <li
                    key={e.id}
                    className={`log__item${e.outcome === 'crashed' ? ' is-crashed' : ''}${e.random ? ' is-random' : ' is-mine'}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setDetailFor(e.id)}
                    onKeyDown={(ev) => ev.key === 'Enter' && setDetailFor(e.id)}
                  >
                    <div className="log__row">
                      <span className={`outcome outcome--${e.outcome}`}>{e.outcome === 'crashed' ? '💥 Crashed' : 'Landed'}</span>
                      <span className="log__time" data-tip={airportTimeTip(e.at, airports[e.to]?.tz ?? null, e.toCity ?? e.to)}>
                        {localStampTz(e.at)}
                      </span>
                    </div>
                    <div className="log__row">
                      <span className="log__flight">{e.flightNumber}</span>
                      <span className="log__route">{route([e.from, e.to])}</span>
                      <span className="log__type">{e.aircraftType}</span>
                      <span className={`origin-badge${e.random ? ' is-random' : ' is-mine'}`}>{e.random ? 'Random' : 'Yours'}</span>
                    </div>
                    <div className="log__row log__row--sub">
                      <span className="muted">
                        {e.paxCount ?? 0} passenger{e.paxCount === 1 ? '' : 's'} {e.outcome === 'landed' ? 'delivered' : 'aboard'}
                      </span>
                      <button
                        className="link-btn"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setManifestFor(e.id);
                        }}
                      >
                        Passengers
                      </button>
                    </div>
                  </li>
                ))}
                {status && status.logTotal > log.length && (
                  <li className="muted more">
                    Showing the latest {log.length} of {status.logTotal.toLocaleString()}
                  </li>
                )}
              </ul>
            ))}
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
      {detailFor && (
        <LogFlightModal
          entryId={detailFor}
          onClose={() => setDetailFor(null)}
          onPassengers={() => {
            setManifestFor(detailFor);
            setDetailFor(null);
          }}
        />
      )}
      {manifestFor && <PassengerModal load={() => api.sim.logPassengers(manifestFor)} onClose={() => setManifestFor(null)} />}
      {confirmClear &&
        createPortal(
          <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setConfirmClear(false)}>
            <div className="modal modal--small glass" role="alertdialog" aria-label="Clear all flights">
              <div className="modal__body">
                <div className="modal__title">Clear all flights?</div>
                <p className="muted">This removes all {status?.tripCount.toLocaleString() ?? ''} active and scheduled flights. Your flight log is kept.</p>
                <div className="pax-editor__actions">
                  <button className="btn" onClick={() => setConfirmClear(false)} autoFocus>
                    Cancel
                  </button>
                  <button className="btn btn--danger-solid" onClick={clearAll}>
                    Clear all
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </aside>
  );
}
