/** Time formatting in airport-local or the user's local time zone. */

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string | null, opts: Intl.DateTimeFormatOptions, key: string): Intl.DateTimeFormat {
  const id = `${tz ?? 'local'}|${key}`;
  let f = cache.get(id);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz ?? undefined });
    } catch {
      f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' });
    }
    cache.set(id, f);
  }
  return f;
}

/** "3:42 PM" at an airport (or local time when tz is null). */
export const timeAt = (ms: number, tz: string | null) => formatter(tz, { hour: 'numeric', minute: '2-digit' }, 't').format(ms);

const dayKey = (ms: number, tz: string | null) => formatter(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }, 'd').format(ms);

/** Calendar days between departure (in its zone) and arrival (in its zone): the "+1" on booking sites. */
export function dayOffset(departMs: number, departTz: string | null, arriveMs: number, arriveTz: string | null): number {
  const a = new Date(dayKey(departMs, departTz)).getTime();
  const b = new Date(dayKey(arriveMs, arriveTz)).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** User's local time, with the date when it isn't today: "3:42 PM" or "Nov 10, 3:42 PM". */
export function localStamp(ms: number): string {
  const sameDay = dayKey(ms, null) === dayKey(Date.now(), null);
  return sameDay ? timeAt(ms, null) : formatter(null, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, 'dt').format(ms);
}

export function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** "3:42 PM EST" — in your time zone (tz = null) or an airport's. */
export const timeTz = (ms: number, tz: string | null = null) =>
  formatter(tz, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }, 'tz').format(ms);

/** Your local time with zone, plus the date when it isn't today: "Nov 10, 3:42 PM EST". */
export function localStampTz(ms: number): string {
  const sameDay = dayKey(ms, null) === dayKey(Date.now(), null);
  return sameDay ? timeTz(ms) : formatter(null, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }, 'dtz').format(ms);
}

/** Hover text: the same moment in the airport's own time zone. */
export const airportTimeTip = (ms: number, tz: string | null, where: string) => `${timeTz(ms, tz)} local time in ${where}`;
