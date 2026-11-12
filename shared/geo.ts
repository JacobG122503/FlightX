/**
 * Small spherical-earth geo helpers shared by client, server and (later) the simulator.
 * Distances are in kilometres unless the name says otherwise.
 */

export const EARTH_RADIUS_KM = 6371.0088;
export const KM_PER_NM = 1.852;

export interface LatLon {
  lat: number;
  lon: number;
}

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from north. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point reached travelling `distanceKm` from `start` on initial bearing `bearing`. */
export function destinationPoint(start: LatLon, bearing: number, distanceKm: number): LatLon {
  const δ = distanceKm / EARTH_RADIUS_KM;
  const θ = toRad(bearing);
  const φ1 = toRad(start.lat);
  const λ1 = toRad(start.lon);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lon: normalizeLon(toDeg(λ2)) };
}

/** The point a fraction `f` (0–1) of the way along the great circle from a to b. */
export function intermediatePoint(a: LatLon, b: LatLon, f: number): LatLon {
  const d = haversineKm(a, b) / EARTH_RADIUS_KM;
  if (d < 1e-9) return { lat: a.lat, lon: a.lon };
  const φ1 = toRad(a.lat);
  const λ1 = toRad(a.lon);
  const φ2 = toRad(b.lat);
  const λ2 = toRad(b.lon);
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return { lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), lon: toDeg(Math.atan2(y, x)) };
}

/** `n + 1` points along the great circle from a to b (inclusive). */
export function greatCircle(a: LatLon, b: LatLon, n = 64): LatLon[] {
  const φ1 = toRad(a.lat);
  const λ1 = toRad(a.lon);
  const φ2 = toRad(b.lat);
  const λ2 = toRad(b.lon);
  const d = haversineKm(a, b) / EARTH_RADIUS_KM;
  if (d < 1e-9) return [a, b];
  const pts: LatLon[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    pts.push({ lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), lon: toDeg(Math.atan2(y, x)) });
  }
  return pts;
}

/**
 * Unwraps longitudes so consecutive points never jump by more than 180°.
 * Lets path layers draw lines across the antimeridian without a stray
 * line spanning the whole map.
 */
export function unwrapLongitudes(points: [number, number][]): [number, number][] {
  if (points.length === 0) return points;
  const out: [number, number][] = [[points[0][0], points[0][1]]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[i - 1][0];
    let lon = points[i][0];
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    out.push([lon, points[i][1]]);
  }
  return out;
}

export interface MovingPoint extends LatLon {
  gsKt: number | null;
  trackDeg: number | null;
  onGround: boolean;
  ts: number;
}

/** Longest we keep extrapolating a position without a fresh one. */
export const MAX_EXTRAPOLATE_SEC = 150;

/**
 * Dead reckoning: where the aircraft is *now*, given its last position, ground
 * speed and track. Keeps planes moving smoothly between refreshes.
 */
export function extrapolate(p: MovingPoint, nowMs: number): LatLon {
  if (p.onGround || !p.gsKt || p.trackDeg == null || p.gsKt < 30) return p;
  const dtSec = Math.min(Math.max(0, (nowMs - p.ts) / 1000), MAX_EXTRAPOLATE_SEC);
  if (dtSec < 0.05) return p;
  const km = (p.gsKt * KM_PER_NM * dtSec) / 3600;
  return destinationPoint(p, p.trackDeg, km);
}
