import { useEffect, useState, type ReactNode } from 'react';
import type { AircraftPhoto, FlightState } from '../../shared/types';
import type { SimPhase } from '../../shared/sim';
import { airportTimeTip, timeTz } from '../lib/time';
import { api } from '../api';
import type { SelectedFlight } from '../hooks/useFlightDetail';
import { useNow } from '../hooks/useNow';
import { extrapolate, haversineKm } from '../../shared/geo';
import { PERSON_EMOJI, planeColor } from '../lib/icons';
import {
  fmtAltitude,
  fmtCoord,
  fmtDuration,
  fmtHeading,
  fmtMiFromKm,
  fmtMiFromNm,
  fmtSpeed,
  fmtSpeedMph,
  fmtVerticalRate,
} from '../lib/format';

interface Props {
  id: string;
  state: FlightState | null;
  selected: SelectedFlight;
  follow: boolean;
  onFollow: (on: boolean) => void;
  /** "Hide others": show only this aircraft and fit its whole route on screen. */
  focus: boolean;
  onFocus: (on: boolean) => void;
  onZoomTo: () => void;
  onClose: () => void;
  /** Crash (delete) the aircraft. */
  onCrash: () => Promise<void>;
  /** After a nudge: refresh the map and lists. */
  onNudged: () => void;
}

const PHASE_LABEL: Record<SimPhase, string> = {
  gate: 'At the gate',
  supersonic: 'Supersonic cruise',
  refuel: 'Refueling from a tanker',
  walk: 'Walking',
  swim: 'Swimming',
  'taxi-out': 'Taxiing out',
  climb: 'Climbing',
  cruise: 'Cruising',
  descent: 'Descending',
  approach: 'On approach',
  'taxi-in': 'Taxiing to the gate',
};

function Photo({ photo, loading, alt, emoji }: { photo: AircraftPhoto | null; loading: boolean; alt: string; emoji?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSrc(photo ? (photo.large ?? photo.thumbnail) : null);
    setFailed(false);
  }, [photo]);

  if (emoji) {
    return (
      <div className="photo photo--emoji" aria-label={alt}>
        <span>{emoji}</span>
      </div>
    );
  }

  if (!photo || failed || !src) {
    return (
      <div className={`photo photo--empty${loading ? ' is-loading' : ''}`}>
        {!loading && (
          <>
            <svg viewBox="0 0 64 64" aria-hidden>
              <path d="M32 6c2.2 0 3.6 2.4 3.6 5.4v13.2l20.4 12v5.2l-20.4-6.2v10.6l6 4.6v4.2L32 52l-9.6 3V50.8l6-4.6V35.6L8 41.8v-5.2l20.4-12V11.4C28.4 8.4 29.8 6 32 6z" />
            </svg>
            <span>No photo available</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="photo">
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        onError={() => {
          if (src !== photo.thumbnail) setSrc(photo.thumbnail);
          else setFailed(true);
        }}
      />
      <a className="photo__credit" href={photo.link ?? undefined} target="_blank" rel="noreferrer">
        Representative photo · {photo.source}
      </a>
    </div>
  );
}

function Row({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="row">
      <dt>{label}</dt>
      <dd>
        {value}
        {sub && <span className="row__sub">{sub}</span>}
      </dd>
    </div>
  );
}

/** "Purdue University Airport — West Lafayette, Indiana, United States" */
const airportTip = (a: { name: string; city: string | null; region: string | null; country: string | null }) =>
  `${a.name} — ${[a.city, a.region !== a.city ? a.region : null, a.country].filter(Boolean).join(', ')}`;

export function FlightPanel({ id, state, selected, follow, onFollow, focus, onFocus, onZoomTo, onClose, onCrash, onNudged }: Props) {
  const [crashArmed, setCrashArmed] = useState(false);
  const [nudging, setNudging] = useState(false);
  const [nudgeError, setNudgeError] = useState<string | null>(null);
  useEffect(() => {
    if (!crashArmed) return;
    const t = window.setTimeout(() => setCrashArmed(false), 3000);
    return () => window.clearTimeout(t);
  }, [crashArmed]);
  const now = useNow(1000);
  const { detail, photo, photoLoading } = selected;
  const route = detail?.route ?? null;
  const aircraft = detail?.aircraft ?? null;
  const sim = detail?.sim ?? null;

  // Close on Escape.
  useEffect(() => {
    // Escape closes the panel — unless a dialog (seat map, passengers) is open on top of it.
    const onKey = (e: KeyboardEvent) =>
      e.key === 'Escape' && document.activeElement?.tagName !== 'INPUT' && !document.querySelector('.modal-backdrop') && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const title = state?.callsign ?? aircraft?.reg ?? state?.reg ?? id.toUpperCase();
  const subtitle = route?.airline?.name ?? aircraft?.owner;
  const typeCode = state?.typeCode ?? aircraft?.typeCode;
  const reg = state?.reg ?? aircraft?.reg;
  const pos = state ? extrapolate(state, now) : null;

  let progress: { pct: number; flownKm: number; leftKm: number; etaMin: number | null } | null = null;
  if (route && pos) {
    const flownKm = haversineKm(route.origin, pos);
    const leftKm = haversineKm(pos, route.destination);
    const pct = state?.onGround && leftKm < 10 ? 1 : flownKm / Math.max(1, flownKm + leftKm);
    const etaMin = sim && now < sim.landAt ? (sim.landAt - now) / 60_000 : null;
    progress = { pct, flownKm, leftKm, etaMin };
  }

  return (
    <aside className="panel panel--right glass" aria-label={`Details for ${title}`}>
      <div className="panel__media">
        <Photo photo={photo} loading={photoLoading} alt={`${typeCode ?? 'Aircraft'} ${reg ?? ''}`.trim()} emoji={state ? PERSON_EMOJI[state.kind] : undefined} />
        <button className="panel__close" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24"><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z" /></svg>
        </button>
      </div>

      <div className="panel__body">
        <div className="panel__head">
          <div className="panel__titles">
            <h2 className="panel__callsign">{title}</h2>
            {subtitle && <div className="panel__subtitle">{subtitle}</div>}
          </div>
          <div className="panel__badges">
            {typeCode && <span className="badge">{typeCode}</span>}
            {reg && <span className="badge badge--muted">{reg}</span>}
          </div>
        </div>

        {route ? (
          <div className="route">
            <div className="route__ends">
              <div className="route__end">
                <div className="route__code" data-tip={airportTip(route.origin)}>{route.origin.iata ?? route.origin.icao}</div>
                <div className="route__city" title={route.origin.name}>{route.origin.city ?? route.origin.name}</div>
              </div>
              <div className="route__end route__end--right">
                <div className="route__code" data-tip={airportTip(route.destination)}>{route.destination.iata ?? route.destination.icao}</div>
                <div className="route__city" title={route.destination.name}>{route.destination.city ?? route.destination.name}</div>
              </div>
            </div>
            {progress && (
              <>
                <div className="route__bar" aria-label={`${Math.round(progress.pct * 100)}% complete`}>
                  <div className="route__fill" style={{ width: `${progress.pct * 100}%` }} />
                  <svg className="route__plane" style={{ left: `${progress.pct * 100}%` }} viewBox="0 0 64 64" aria-hidden>
                    <path d="M32 6c2.2 0 3.6 2.4 3.6 5.4v13.2l20.4 12v5.2l-20.4-6.2v10.6l6 4.6v4.2L32 52l-9.6 3V50.8l6-4.6V35.6L8 41.8v-5.2l20.4-12V11.4C28.4 8.4 29.8 6 32 6z" />
                  </svg>
                </div>
                <div className="route__stats">
                  <span>{fmtMiFromKm(progress.flownKm)} flown</span>
                  {progress.etaMin != null && <span className="route__eta">~{fmtDuration(progress.etaMin)} left</span>}
                  <span>{fmtMiFromKm(progress.leftKm)} to go</span>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="route route--unknown">{detail ? 'This flight has finished.' : 'Loading flight…'}</div>
        )}

        <div className="panel__actions">
          <button className={`btn${follow ? ' is-on' : ''}`} onClick={() => onFollow(!follow)} aria-pressed={follow}>
            <svg viewBox="0 0 24 24"><path d="M12 2 4.5 20.3l.7.7L12 18l6.8 3 .7-.7z" /></svg>
            {follow ? 'Following' : 'Follow'}
          </button>
          <button className="btn" onClick={onZoomTo}>
            <svg viewBox="0 0 24 24"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 3h-2.07A7 7 0 0 0 13 5.07V3h-2v2.07A7 7 0 0 0 5.07 11H3v2h2.07A7 7 0 0 0 11 18.93V21h2v-2.07A7 7 0 0 0 18.93 13H21z" /></svg>
            Zoom to
          </button>
          <button
            className={`btn${focus ? ' is-on' : ''}`}
            onClick={() => onFocus(!focus)}
            aria-pressed={focus}
            title={focus ? 'Show all planes again' : 'Hide all other planes and show this flight’s whole route'}
          >
            <svg viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" /></svg>
            Focus
          </button>
        </div>

        {state && (
          <div className="panel__row">
            <button
              className="btn nudge-btn"
              disabled={sim?.phase !== 'gate' || nudging}
              title={sim?.phase === 'gate' ? 'Skip the wait: push back into the taxi queue now' : 'Only while the plane is waiting at its gate'}
              onClick={async () => {
                setNudging(true);
                setNudgeError(null);
                try {
                  await api.sim.nudge(id);
                  onNudged();
                } catch (err) {
                  setNudgeError(err instanceof Error ? err.message : String(err));
                } finally {
                  window.setTimeout(() => setNudging(false), 4500);
                }
              }}
            >
              <svg viewBox="0 0 24 24"><path d="M5 5h2v14H5zm4 0 10 7-10 7z" /></svg>
              {nudging ? 'Nudged' : 'Nudge'}
            </button>
            <button
              className={`btn btn--danger crash-btn${crashArmed ? ' is-armed' : ''}`}
              onClick={() => {
                if (!crashArmed) setCrashArmed(true);
                else {
                  setCrashArmed(false);
                  void onCrash();
                }
              }}
            >
              <svg viewBox="0 0 24 24"><path d="M13 2 11 8 5 5l3 6-6 2 6 2-3 6 6-3 2 6 2-6 6 3-3-6 6-2-6-2 3-6-6 3z" /></svg>
              {crashArmed ? 'Click again 💥' : 'Crash this plane'}
            </button>
          </div>
        )}
        {nudgeError && <div className="muted nudge-error">{nudgeError}</div>}

        {sim && (
          <section className="section">
            <h3 className="section__title">
              Trip
              <span className="section__meta">{sim.random ? '🎲 Random flight' : '✈ Booked by you'}</span>
            </h3>
            <dl className="grid">
              <Row
                label="Passengers"
                value={sim.passengers.toLocaleString()}
                sub={`of ${sim.capacity.toLocaleString()} seats`}
              />
              <Row label="Phase" value={PHASE_LABEL[sim.phase]} />
              <Row
                label={now < sim.takeoffAt ? 'Takes off' : 'Took off'}
                value={
                  <span data-tip={airportTimeTip(sim.takeoffAt, sim.origin.tz, sim.origin.city?.split(',')[0] ?? sim.origin.iata)}>
                    {now < sim.takeoffAt ? '~' : ''}
                    {timeTz(sim.takeoffAt)}
                  </span>
                }
                sub={sim.origin.iata}
              />
              <Row
                label="Lands"
                value={<span data-tip={airportTimeTip(sim.landAt, sim.destination.tz, sim.destination.city?.split(',')[0] ?? sim.destination.iata)}>{timeTz(sim.landAt)}</span>}
                sub={sim.destination.iata}
              />
              <Row label="Leg" value={`${sim.legIndex + 1} of ${sim.legCount}`} sub={sim.legCount > 1 ? `to ${sim.finalDestination.iata}` : undefined} />
              <Row label="Cruise" value={sim.cruiseFt >= 18000 ? `FL${Math.round(sim.cruiseFt / 100)}` : sim.cruiseFt > 0 ? `${sim.cruiseFt.toLocaleString()} ft` : 'Ground level'} sub={fmtMiFromNm(sim.distanceNm)} />
              {sim.nextLeg && (
                <Row
                  label="Next flight"
                  value={sim.nextLeg.flightNumber}
                  sub={
                    <span data-tip={airportTimeTip(sim.nextLeg.departAt, sim.nextLeg.from.tz, sim.nextLeg.from.city?.split(',')[0] ?? sim.nextLeg.from.iata)}>
                      {sim.nextLeg.from.iata} → {sim.nextLeg.to.iata} · {timeTz(sim.nextLeg.departAt)}
                    </span>
                  }
                />
              )}
            </dl>
          </section>
        )}

        {state ? (
          <section className="section">
            <h3 className="section__title">Position</h3>
            <dl className="grid">
              <Row
                label="Altitude"
                value={
                  <>
                    <span className="dot" style={{ background: planeColor(state) }} />
                    {fmtAltitude(state.altFt, state.onGround)}
                  </>
                }
              />
              <Row label="Vertical speed" value={fmtVerticalRate(state.vrFpm)} />
              <Row label="Ground speed" value={fmtSpeed(state.gsKt)} sub={fmtSpeedMph(state.gsKt)} />
              <Row label="Track" value={fmtHeading(state.trackDeg)} />
              <Row label="Latitude" value={pos ? fmtCoord(pos.lat, 'N', 'S') : '—'} />
              <Row label="Longitude" value={pos ? fmtCoord(pos.lon, 'E', 'W') : '—'} />
              <Row label="Squawk" value={state.squawk ?? '—'} />

            </dl>
          </section>
        ) : (
          <section className="section">
            <div className="muted">{detail ? 'This plane isn’t flying any more.' : 'Loading…'}</div>
          </section>
        )}

        <section className="section">
          <h3 className="section__title">Aircraft</h3>
          <dl className="grid">
            <Row
              label="Type"
              value={aircraft?.typeName ? `${aircraft.manufacturer ? `${aircraft.manufacturer} ` : ''}${aircraft.typeName}` : (typeCode ?? '—')}
            />
            <Row label="Registration" value={reg ?? '—'} />
            <Row label="Operator" value={aircraft?.owner ?? route?.airline?.name ?? '—'} />
            <Row label="Country" value={aircraft?.country ?? '—'} />
            <Row label="ICAO 24-bit" value={<span className="mono">{id.toUpperCase()}</span>} />
            <Row label="Callsign" value={state?.callsign ?? '—'} />
          </dl>
        </section>
      </div>
    </aside>
  );
}
