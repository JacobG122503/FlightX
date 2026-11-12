import { memo, useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { api, serverNow } from '../../api';
import type { CustomPassenger, ItineraryOption, PlanResponse, SimLogEntry, SimStatusResponse, SimTripSummary, TimerResponse, TripView } from '../../../shared/sim';
import type { FlightState } from '../../../shared/types';
import { SearchBox } from '../SearchBox';
import { ItineraryCard } from './ItineraryCard';
import { PassengerEditor } from '../passengers/PassengerEditor';
import { PassengerModal } from '../passengers/PassengerModal';
import { LogFlightModal } from './LogFlightModal';
import { TimerForm } from './TimerForm';
import { airportTimeTip, fmtMinutes, fmtTimer, localStampTz } from '../../lib/time';
import { useNow } from '../../hooks/useNow';

interface Props {
  open: boolean;
  onToggle: () => void;
  status: SimStatusResponse | null;
  onChanged: () => void;
  /** Select a flight on the map (and fly to it). */
  onSelectFlight: (id: string) => void;
  /** Planes in view, for instant search matches. */
  flights: FlightState[];
  onPickSearch: (flight: FlightState) => void;
  /** Set when the simulator service isn't answering. */
  error: string | null;
  view: TripView;
  onView: (view: TripView) => void;
}

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
const CREATE_KEY = 'flightx:create';
type CreateMode = 'route' | 'timer' | 'random';
const CREATE_MODES: [CreateMode, string][] = [
  ['route', 'Fly somewhere'],
  ['timer', 'Timer flight'],
  ['random', 'Random'],
];
function loadCreateMode(): CreateMode {
  try {
    const v = localStorage.getItem(CREATE_KEY);
    return v === 'timer' || v === 'random' ? v : 'route';
  } catch {
    return 'route';
  }
}
function loadSections(): { active: boolean; log: boolean } {
  try {
    return { active: true, log: true, ...JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}') };
  } catch {
    return { active: true, log: true };
  }
}

type Airports = SimStatusResponse['airports'];

/** Airport codes joined by arrows, each with a hover popup saying where it is. */
function Route({ codes, airports }: { codes: string[]; airports: Airports }) {
  return (
    <>
      {codes.map((c, i) => {
        const a = airports[c];
        return (
          <span key={i}>
            {i > 0 && ' → '}
            <span className="code" data-tip={a ? `${a.name} — ${a.place}` : undefined}>
              {c}
            </span>
          </span>
        );
      })}
    </>
  );
}

// The lists re-render only rows that actually changed: rebuilding hundreds of rows on every
// refresh made the map stutter (most noticeably while following a plane).
const sameTrip = (x: SimTripSummary, y: SimTripSummary) =>
  x.id === y.id &&
  x.status === y.status &&
  x.activeLeg === y.activeLeg &&
  x.activeFlightId === y.activeFlightId &&
  x.legs.length === y.legs.length &&
  Math.round(x.progress * 300) === Math.round(y.progress * 300);

const TripRow = memo(
  function TripRow({ trip: t, leftText, airports, onSelect }: { trip: SimTripSummary; leftText: string; airports: Airports; onSelect: (id: string) => void }) {
    const leg = t.legs[t.activeLeg];
    const id = t.activeFlightId ?? leg.flightId;
    return (
      <li>
        <div className="trip" role="button" tabIndex={0} onClick={() => onSelect(id)} onKeyDown={(e) => e.key === 'Enter' && onSelect(id)}>
          <div className="trip__row">
            <span className="trip__flight">{leg.flightNumber}</span>
            <span className="trip__route">
              <Route codes={[t.legs[0].from, ...t.legs.map((l) => l.to)]} airports={airports} />
            </span>
            <span className={`origin-badge${t.random ? ' is-random' : ' is-mine'}`}>{t.random ? 'Random' : 'Yours'}</span>
          </div>
          <div className="trip__row trip__row--sub">
            <span>{STATUS_LABEL[t.status]}</span>
            <span>{leftText}</span>
          </div>
          <div className="trip__bar">
            <div style={{ width: `${t.progress * 100}%` }} />
          </div>
        </div>
      </li>
    );
  },
  (a, b) => a.leftText === b.leftText && a.onSelect === b.onSelect && sameTrip(a.trip, b.trip),
);

const LogRow = memo(
  function LogRow({ entry: e, airports, onDetails, onPassengers }: { entry: SimLogEntry; airports: Airports; onDetails: (id: string) => void; onPassengers: (id: string) => void }) {
    return (
      <li
        className={`log__item${e.outcome === 'crashed' ? ' is-crashed' : ''}${e.random ? ' is-random' : ' is-mine'}`}
        role="button"
        tabIndex={0}
        onClick={() => onDetails(e.id)}
        onKeyDown={(ev) => ev.key === 'Enter' && onDetails(e.id)}
      >
        <div className="log__row">
          <span className={`outcome outcome--${e.outcome}`}>{e.outcome === 'crashed' ? '💥 Crashed' : 'Landed'}</span>
          <span className="log__time" data-tip={airportTimeTip(e.at, airports[e.to]?.tz ?? null, e.toCity ?? e.to)}>
            {localStampTz(e.at)}
          </span>
        </div>
        <div className="log__row">
          <span className="log__flight">{e.flightNumber}</span>
          <span className="log__route">
            <Route codes={[e.from, e.to]} airports={airports} />
          </span>
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
              onPassengers(e.id);
            }}
          >
            Passengers
          </button>
        </div>
      </li>
    );
  },
  // Log entries never change once written.
  (a, b) => a.entry.id === b.entry.id && a.onDetails === b.onDetails && a.onPassengers === b.onPassengers,
);

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`chev${open ? ' is-open' : ''}`} viewBox="0 0 24 24" aria-hidden>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function SimSidebar({ open, onToggle, status, onChanged, onSelectFlight, flights, onPickSearch, error, view, onView }: Props) {
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
  const [createMode, setCreateMode] = useState<CreateMode>(loadCreateMode);
  /** The "Add flights" panel and the search box both stay tucked away until opened. */
  const [adding, setAdding] = useState(false);
  const [searching, setSearching] = useState(false);

  // "/" opens search from anywhere (once open, the search box handles it itself).
  useEffect(() => {
    if (!open || searching) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, searching]);

  const switchCreate = (mode: CreateMode) => {
    setCreateMode(mode);
    setMessage(null);
    try {
      localStorage.setItem(CREATE_KEY, mode);
    } catch {
      /* ignore */
    }
  };

  /** A flight made from a length of time: sent like any other flight. */
  const timerSent = ({ trip, targetMin, actualMin }: TimerResponse) => {
    announce(trip);
    if (Math.abs(actualMin - targetMin) > 1) {
      setMessage({ kind: 'ok', text: `Closest possible is ${fmtTimer(actualMin)} — sent ${trip.legs.map((l) => l.flightNumber).join(' + ')} · ${[trip.legs[0].from, ...trip.legs.map((l) => l.to)].join(' → ')}` });
    }
  };

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
    setAdding(false);
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
      setAdding(false);
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
        <div className="brand">
          <svg viewBox="0 0 64 64" className="brand__logo" aria-hidden>
            <path d="M32 6c2.2 0 3.6 2.4 3.6 5.4v13.2l20.4 12v5.2l-20.4-6.2v10.6l6 4.6v4.2L32 52l-9.6 3V50.8l6-4.6V35.6L8 41.8v-5.2l20.4-12V11.4C28.4 8.4 29.8 6 32 6z" />
          </svg>
          <div>
            <div className="brand__name">FlightX</div>
            <div className={`sim-sidebar__sub${error ? ' is-error' : ''}`} title={error ?? undefined}>
              {error
                ? 'Simulator not responding — retrying…'
                : status
                  ? `${status.activeFlights.toLocaleString()} in the air · ${status.tripCount.toLocaleString()} trip${status.tripCount === 1 ? '' : 's'}`
                  : 'Loading…'}
            </div>
          </div>
        </div>
        <div className="sim-sidebar__actions">
          <button
            className={`icon-btn${searching ? ' is-on' : ''}`}
            onClick={() => setSearching((v) => !v)}
            aria-label="Search flights"
            aria-expanded={searching}
            title="Search flights (/)"
          >
            <svg viewBox="0 0 24 24" className="icon-btn__fill">
              <path d="M10.5 4a6.5 6.5 0 1 0 4.03 11.6l4.43 4.43 1.06-1.06-4.43-4.43A6.5 6.5 0 0 0 10.5 4Zm0 1.5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z" />
            </svg>
          </button>
          <button className="icon-btn" onClick={onToggle} aria-label="Hide the simulation panel" title="Hide">
            <svg viewBox="0 0 24 24">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
        </div>
      </div>

      {searching && (
        <div className="sim-search">
          <SearchBox
            flights={flights}
            autoFocus
            onClose={() => setSearching(false)}
            onPick={(f) => {
              onPickSearch(f);
              setSearching(false);
            }}
          />
        </div>
      )}

      <div className="sim-sidebar__body">
        <section className="sim-section">
          <button className={`add-btn${adding ? ' is-open' : ''}`} onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />
            </svg>
            Add flights
            <Chevron open={adding} />
          </button>

          {adding && (
            <div className="add-panel">
              <div className="create-tabs" role="tablist" aria-label="How to add flights">
                {CREATE_MODES.map(([mode, label]) => (
                  <button key={mode} role="tab" aria-selected={createMode === mode} className={createMode === mode ? 'is-active' : ''} onClick={() => switchCreate(mode)}>
                    {label}
                  </button>
                ))}
              </div>

              {createMode === 'timer' && (
                <TimerForm busy={busy} setBusy={setBusy} onSent={timerSent} onError={(text) => setMessage({ kind: 'error', text })} />
              )}

              {createMode === 'random' && (
                <>
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
                  <p className="muted add-panel__hint">Random flights on real routes and connections, pushing back within a minute.</p>
                </>
              )}

              {createMode === 'route' && (
                <>
                  <form className="trip-form" onSubmit={submit}>
                    <input
                      className="trip-form__input"
                      placeholder="Where to?  e.g. “Iowa to Florida”"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      spellCheck={false}
                      autoFocus
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
                </>
              )}
            </div>
          )}

          {message && <div className={`sim-msg sim-msg--${message.kind}`}>{message.text}</div>}
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
                  {trips.map((t) => (
                    <TripRow key={t.id} trip={t} leftText={`${fmtMinutes(Math.max(0, (t.finalArriveAt - now) / 60_000))} left`} airports={airports} onSelect={onSelectFlight} />
                  ))}
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
                  <LogRow key={e.id} entry={e} airports={airports} onDetails={setDetailFor} onPassengers={setManifestFor} />
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
