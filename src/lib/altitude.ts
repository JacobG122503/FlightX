/** Altitude → colour scale shared by aircraft icons, trails and the legend. */

export type RGBA = [number, number, number, number];

export const GROUND_COLOR = '#8b95a5';

/** [feet, hex colour] stops, interpolated linearly. */
export const ALTITUDE_STOPS: [number, string][] = [
  [0, '#ff4d3d'],
  [2_000, '#ff8a1f'],
  [6_000, '#ffc21a'],
  [10_000, '#b6e22e'],
  [20_000, '#2fe0a2'],
  [30_000, '#2db7ff'],
  [38_000, '#7a7bff'],
  [45_000, '#d36bff'],
];

const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const STOPS_RGB = ALTITUDE_STOPS.map(([ft, hex]) => [ft, hexToRgb(hex)] as const);
const GROUND_RGB = hexToRgb(GROUND_COLOR);

/** Altitudes are bucketed so the icon atlas only needs a few dozen colours. */
export const ALTITUDE_BUCKET_FT = 2_000;

export function altitudeBucket(altFt: number | null, onGround: boolean): number {
  if (onGround) return -1;
  if (altFt == null) return 0;
  return Math.max(0, Math.min(46_000, Math.round(altFt / ALTITUDE_BUCKET_FT) * ALTITUDE_BUCKET_FT));
}

export function altitudeRgb(altFt: number | null, onGround = false): [number, number, number] {
  if (onGround) return GROUND_RGB;
  const ft = Math.max(0, altFt ?? 0);
  for (let i = 1; i < STOPS_RGB.length; i++) {
    const [hiFt, hi] = STOPS_RGB[i];
    if (ft <= hiFt) {
      const [loFt, lo] = STOPS_RGB[i - 1];
      const f = (ft - loFt) / (hiFt - loFt);
      return [0, 1, 2].map((k) => Math.round(lo[k] + (hi[k] - lo[k]) * f)) as [number, number, number];
    }
  }
  return STOPS_RGB[STOPS_RGB.length - 1][1] as [number, number, number];
}

export function altitudeRgba(altFt: number | null, onGround = false, alpha = 255): RGBA {
  const [r, g, b] = altitudeRgb(altFt, onGround);
  return [r, g, b, alpha];
}

export function altitudeCss(altFt: number | null, onGround = false): string {
  const [r, g, b] = altitudeRgb(altFt, onGround);
  return `rgb(${r}, ${g}, ${b})`;
}

/** CSS gradient for the legend, 0 → 45,000 ft. */
export const ALTITUDE_GRADIENT = `linear-gradient(90deg, ${ALTITUDE_STOPS.map(
  ([ft, hex]) => `${hex} ${((ft / 45_000) * 100).toFixed(1)}%`,
).join(', ')})`;
