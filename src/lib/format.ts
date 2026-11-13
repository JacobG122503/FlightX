const nf = new Intl.NumberFormat('en-US');

const KM_PER_MI = 1.609344;
const MI_PER_NM = 1.150779;

export const fmtInt = (n: number) => nf.format(Math.round(n));

export function fmtAltitude(altFt: number | null, onGround: boolean): string {
  if (onGround) return 'On ground';
  if (altFt == null) return '—';
  return `${fmtInt(altFt)} ft`;
}


export const fmtSpeed = (kt: number | null) => (kt == null ? '—' : `${fmtInt(kt)} kt`);
export const fmtSpeedMph = (kt: number | null) => (kt == null ? null : `${fmtInt(kt * MI_PER_NM)} mph`);

export function fmtVerticalRate(fpm: number | null): string {
  if (fpm == null) return '—';
  if (Math.abs(fpm) < 64) return 'Level';
  return `${fpm > 0 ? '↑' : '↓'} ${fmtInt(Math.abs(fpm))} fpm`;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

export const fmtHeading = (deg: number | null) => (deg == null ? '—' : `${Math.round(deg)}° ${compass(deg)}`);

export const fmtCoord = (n: number, pos: string, neg: string) => `${Math.abs(n).toFixed(4)}° ${n >= 0 ? pos : neg}`;

/** Statute miles. */
export const fmtMiFromKm = (km: number) => `${fmtInt(km / KM_PER_MI)} mi`;
export const fmtMiFromNm = (nm: number) => `${fmtInt(nm * MI_PER_NM)} mi`;

export function fmtDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—';
  const total = Math.round(minutes);
  if (total >= 48 * 60) return `${Math.floor(total / 1440)}d ${Math.floor((total % 1440) / 60)}h`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
