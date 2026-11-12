const nf = new Intl.NumberFormat('en-US');

export const fmtInt = (n: number) => nf.format(Math.round(n));

export function fmtAltitude(altFt: number | null, onGround: boolean): string {
  if (onGround) return 'On ground';
  if (altFt == null) return '—';
  return `${fmtInt(altFt)} ft`;
}

export function fmtAltitudeMeters(altFt: number | null, onGround: boolean): string | null {
  if (onGround || altFt == null) return null;
  return `${fmtInt(altFt / 3.28084)} m`;
}

export const fmtSpeed = (kt: number | null) => (kt == null ? '—' : `${fmtInt(kt)} kt`);
export const fmtSpeedKmh = (kt: number | null) => (kt == null ? null : `${fmtInt(kt * 1.852)} km/h`);

export function fmtVerticalRate(fpm: number | null): string {
  if (fpm == null) return '—';
  if (Math.abs(fpm) < 64) return 'Level';
  return `${fpm > 0 ? '↑' : '↓'} ${fmtInt(Math.abs(fpm))} fpm`;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

export const fmtHeading = (deg: number | null) => (deg == null ? '—' : `${Math.round(deg)}° ${compass(deg)}`);

export const fmtCoord = (n: number, pos: string, neg: string) => `${Math.abs(n).toFixed(4)}° ${n >= 0 ? pos : neg}`;

export const fmtKm = (km: number) => `${fmtInt(km)} km`;

export function fmtDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

export const FEED_LABEL: Record<string, string> = {
  opensky: 'OpenSky Network',
  adsbfi: 'adsb.fi',
  adsblol: 'adsb.lol',
  sim: 'Simulator',
  observed: 'observed',
};
