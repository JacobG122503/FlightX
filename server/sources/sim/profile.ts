/**
 * Flight profile: a leg is fully described by its departure time and a few
 * parameters, and its state at any moment is computed from the clock. That's
 * what makes flights keep "flying" while FlightX is closed — nothing has to
 * tick in the background; we just evaluate the profile at the current time.
 *
 * Phases: taxi-out → climb (fast below 10,000 ft, slower above) → cruise
 * (true airspeed ± a jet-stream wind component) → descent (≈3 NM per 1,000 ft)
 * → approach → taxi-in.
 */
import { bearingDeg, intermediatePoint, destinationPoint, type LatLon } from '../../../shared/geo';
import type { SimPhase } from '../../../shared/sim';
import type { AircraftType } from './aircraft';
import { distNm } from './data';

export interface ProfilePhase {
  name: SimPhase;
  t0: number;
  t1: number;
  /** Distance flown along the great circle (NM) at start/end. */
  s0: number;
  s1: number;
  /** Altitude (ft MSL) at start/end. */
  a0: number;
  a1: number;
}

export interface Profile {
  phases: ProfilePhase[];
  departAt: number;
  takeoffAt: number;
  landAt: number;
  arriveAt: number;
  distanceNm: number;
  cruiseFt: number;
}

interface Endpoint extends LatLon {
  elevFt: number;
}

const MIN = 60_000;
const APPROACH_FT = 3000;
const APPROACH_KT = 150;
const APPROACH_FPM = 750;

/** Along-track wind (kt): mid-latitude westerlies help eastbound flights and slow westbound ones. */
export function windComponent(from: LatLon, to: LatLon): number {
  const track = (bearingDeg(from, to) * Math.PI) / 180;
  const midLat = Math.abs((from.lat + to.lat) / 2);
  const band = Math.min(1, Math.max(0, (midLat - 15) / 20)) * (midLat > 60 ? 0.6 : 1);
  return 45 * band * Math.sin(track);
}

export function buildProfile(opts: {
  from: Endpoint;
  to: Endpoint;
  type: AircraftType;
  cruiseFt: number;
  departAt: number;
  taxiOutMin: number;
  taxiInMin: number;
}): Profile {
  const { from, to, type, departAt, taxiOutMin, taxiInMin } = opts;
  const D = Math.max(1, distNm(from, to));
  const cruiseGs = Math.max(150, type.cruiseKt + windComponent(from, to));
  const topOfApproach = to.elevFt + APPROACH_FT;

  // Lower the cruise altitude until climb + descent fit comfortably in the distance.
  const segments = (cruiseFt: number) => {
    const c1Top = Math.min(10000, cruiseFt);
    // Speeds never exceed what the type can do (matters for slow piston aircraft).
    const c1 = { min: Math.max(0, c1Top - from.elevFt) / type.climb1 + 0.75, gs: Math.min(type.kind === 'light' ? 180 : 220, cruiseGs * 0.8) };
    const c2 = { min: Math.max(0, cruiseFt - c1Top) / type.climb2, gs: Math.min((290 + cruiseGs) / 2, cruiseGs * 0.9) };
    const ds = { min: Math.max(0, cruiseFt - topOfApproach) / type.descent, gs: Math.min((cruiseGs + 250) / 2, cruiseGs * 1.05) };
    const ap = { min: Math.min(APPROACH_FT, Math.max(1000, cruiseFt - to.elevFt)) / APPROACH_FPM, gs: Math.min(APPROACH_KT, type.cruiseKt * 0.7) };
    const nm = (p: { min: number; gs: number }) => (p.min / 60) * p.gs;
    return { c1Top, c1, c2, ds, ap, used: nm(c1) + nm(c2) + nm(ds) + nm(ap), nm };
  };
  let cruiseFt = opts.cruiseFt;
  let seg = segments(cruiseFt);
  while (seg.used > D * 0.9 && cruiseFt > Math.max(from.elevFt, to.elevFt) + 5000) {
    cruiseFt -= 1000;
    seg = segments(cruiseFt);
  }

  // Very short hops: squeeze the profile proportionally so it still ends at the destination.
  const squeeze = seg.used > D ? D / seg.used : 1;
  const c1nm = seg.nm(seg.c1) * squeeze;
  const c2nm = seg.nm(seg.c2) * squeeze;
  const dsnm = seg.nm(seg.ds) * squeeze;
  const apnm = seg.nm(seg.ap) * squeeze;
  const crnm = Math.max(0, D - c1nm - c2nm - dsnm - apnm);

  const phases: ProfilePhase[] = [];
  let t = departAt;
  let s = 0;
  const push = (name: SimPhase, minutes: number, ds: number, a0: number, a1: number) => {
    if (minutes <= 0) return;
    phases.push({ name, t0: t, t1: t + minutes * MIN, s0: s, s1: s + ds, a0, a1 });
    t += minutes * MIN;
    s += ds;
  };

  push('taxi-out', taxiOutMin, 0, from.elevFt, from.elevFt);
  const takeoffAt = t;
  push('climb', seg.c1.min * squeeze, c1nm, from.elevFt, seg.c1Top);
  push('climb', seg.c2.min * squeeze, c2nm, seg.c1Top, cruiseFt);
  push('cruise', (crnm / cruiseGs) * 60, crnm, cruiseFt, cruiseFt);
  push('descent', seg.ds.min * squeeze, dsnm, cruiseFt, topOfApproach);
  push('approach', seg.ap.min * squeeze, Math.max(0, D - s), topOfApproach, to.elevFt);
  const landAt = t;
  push('taxi-in', taxiInMin, 0, to.elevFt, to.elevFt);

  return { phases, departAt, takeoffAt, landAt, arriveAt: t, distanceNm: D, cruiseFt };
}

export interface ProfileState extends LatLon {
  phase: SimPhase;
  altFt: number;
  onGround: boolean;
  gsKt: number;
  vrFpm: number;
  trackDeg: number;
}

/** Aircraft state at time `t`, or null before pushback / after reaching the gate. */
export function evaluate(p: Profile, from: Endpoint, to: Endpoint, t: number, seed: number): ProfileState | null {
  if (t < p.departAt || t >= p.arriveAt) return null;
  const ph = p.phases.find((x) => t >= x.t0 && t < x.t1) ?? p.phases[p.phases.length - 1];
  const f = (t - ph.t0) / (ph.t1 - ph.t0);
  const s = ph.s0 + (ph.s1 - ph.s0) * f;
  const altFt = Math.round(ph.a0 + (ph.a1 - ph.a0) * f);
  const hours = (ph.t1 - ph.t0) / 3_600_000;
  const onGround = ph.name === 'taxi-out' || ph.name === 'taxi-in';
  const frac = Math.min(1, Math.max(0, s / p.distanceNm));
  let pos = intermediatePoint(from, to, frac);
  if (onGround) {
    // Spread parked/taxiing aircraft around the airport instead of stacking them on one point.
    const angle = (seed % 360) + (ph.name === 'taxi-in' ? 180 : 0);
    pos = destinationPoint(pos, angle, (((seed >>> 9) % 400) + 150) / 1000);
  }
  const ahead = frac < 0.999 ? intermediatePoint(from, to, Math.min(1, frac + 0.001)) : to;
  const trackDeg = frac < 0.999 ? bearingDeg(pos, ahead) : bearingDeg(from, to);
  return {
    lat: pos.lat,
    lon: pos.lon,
    phase: ph.name,
    altFt,
    onGround,
    gsKt: onGround ? 14 : Math.round((ph.s1 - ph.s0) / hours),
    vrFpm: Math.round((ph.a1 - ph.a0) / (hours * 60) / 10) * 10,
    trackDeg: Math.round(trackDeg * 10) / 10,
  };
}

/** Flown path from pushback until `until`, sampled for drawing. */
export function sampleTrack(p: Profile, from: Endpoint, to: Endpoint, until: number, seed: number) {
  const end = Math.min(until, p.arriveAt - 1);
  const span = end - p.takeoffAt;
  const points: { t: number; lat: number; lon: number; altFt: number | null; onGround: boolean }[] = [];
  if (span <= 0) return points;
  const step = Math.max(15_000, span / 400);
  for (let t = p.takeoffAt; t <= end; t += step) {
    const st = evaluate(p, from, to, t, seed);
    if (st) points.push({ t, lat: st.lat, lon: st.lon, altFt: st.onGround ? 0 : st.altFt, onGround: st.onGround });
  }
  return points;
}

