import type { Bounds } from '../../shared/types';

/** Parses "south,west,north,east". West may be greater than east across the antimeridian. */
export function parseBounds(raw: unknown): Bounds | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [south, west, north, east] = parts;
  if (south < -90 || north > 90 || south > north) return null;
  return { south, west, north, east };
}

/** Longitudinal width of the box in degrees (0–360). */
function lonSpan(b: Bounds): number {
  if (b.east - b.west >= 360) return 360;
  const span = b.east >= b.west ? b.east - b.west : b.east + 360 - b.west;
  return Math.min(360, span);
}

/** Returns a predicate testing whether a point is inside the box, padded by `marginFrac` on each side. */
export function containsFn(b: Bounds, marginFrac = 0.15): (lat: number, lon: number) => boolean {
  const span = lonSpan(b);
  const latPad = (b.north - b.south) * marginFrac;
  const lonPad = span * marginFrac;
  const south = b.south - latPad;
  const north = b.north + latPad;
  const west = b.west - lonPad;
  const paddedSpan = span + 2 * lonPad;
  if (paddedSpan >= 360) return (lat) => lat >= south && lat <= north;
  return (lat, lon) => {
    if (lat < south || lat > north) return false;
    const d = (((lon - west) % 360) + 360) % 360;
    return d <= paddedSpan;
  };
}
