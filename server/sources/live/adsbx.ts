/**
 * Client for the free, community-run ADS-B networks that share the
 * "ADSBexchange v2" JSON format:
 *
 *  - adsb.fi  — https://opendata.adsb.fi  (1 request/second, no daily cap)  ← primary
 *  - adsb.lol — https://api.adsb.lol      (500 requests/day)                ← backup
 *
 * Both are personal/non-commercial and volunteer-run, so this client is
 * deliberately polite: requests are spaced out, a 429 ("slow down") makes us
 * stop calling that service until it says we may, and adsb.lol's daily budget
 * is tracked so we never run it to zero.
 */
import { fetchJson, HttpError, errorMessage } from '../../lib/http';
import { TtlCache } from '../../lib/cache';
import { cleanCallsign, guessKind, kindFromAdsbCategory } from '../../../shared/aircraft';
import type { FeedId, FlightState } from '../../../shared/types';

/** Reports with no position update for this long are dropped. */
const MAX_SEEN_POS_SEC = 60;

interface RawAircraft {
  hex: string;
  flight?: string;
  r?: string;
  t?: string;
  alt_baro?: number | 'ground';
  alt_geom?: number;
  gs?: number;
  track?: number;
  true_heading?: number;
  mag_heading?: number;
  baro_rate?: number;
  geom_rate?: number;
  squawk?: string;
  emergency?: string;
  category?: string;
  lat?: number;
  lon?: number;
  seen_pos?: number;
  seen?: number;
  lastPosition?: { lat: number; lon: number; seen_pos: number };
}

interface RawResponse {
  ac?: RawAircraft[];
  aircraft?: RawAircraft[];
  /** Epoch ms (some deployments use seconds). */
  now?: number;
}

function parse(a: RawAircraft, nowMs: number, feed: FeedId): FlightState | null {
  const lat = a.lat ?? a.lastPosition?.lat;
  const lon = a.lon ?? a.lastPosition?.lon;
  const seenPos = a.seen_pos ?? a.lastPosition?.seen_pos ?? a.seen ?? 0;
  if (lat == null || lon == null || seenPos > MAX_SEEN_POS_SEC) return null;
  const onGround = a.alt_baro === 'ground';
  const altFt = onGround ? 0 : typeof a.alt_baro === 'number' ? a.alt_baro : (a.alt_geom ?? null);
  const callsign = cleanCallsign(a.flight);
  const typeCode = a.t?.trim().toUpperCase() || null;
  const gsKt = a.gs != null ? Math.round(a.gs) : null;
  let kind = kindFromAdsbCategory(a.category, typeCode);
  if (kind === 'unknown') kind = guessKind(callsign, gsKt, altFt);
  return {
    id: a.hex.toLowerCase(),
    callsign,
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5,
    altFt,
    onGround,
    gsKt,
    trackDeg: a.track ?? a.true_heading ?? a.mag_heading ?? null,
    vrFpm: a.baro_rate ?? a.geom_rate ?? null,
    squawk: a.squawk ?? null,
    kind,
    reg: a.r?.trim() || null,
    typeCode,
    country: null,
    ts: Math.round(nowMs - seenPos * 1000),
    feed,
    emergency: a.emergency && a.emergency !== 'none' ? a.emergency : null,
  };
}

export interface ProviderConfig {
  id: FeedId;
  name: string;
  /** Minimum gap between requests to this service. */
  minSpacingMs: number;
  /** How long to pause after a 429 if the service doesn't say. */
  defaultBackoffMs: number;
  /** Stop using the service when its reported remaining quota drops to this. */
  reserve: number;
  pointUrl: (lat: number, lon: number, radiusNm: number) => string;
  hexUrl: (id: string) => string;
  callsignUrl: (callsign: string) => string;
  registrationUrl: (reg: string) => string;
}

export class ProviderUnavailable extends Error {}

export class AdsbxProvider {
  private queue: Promise<unknown> = Promise.resolve();
  private lastCall = 0;
  private blockedUntil = 0;
  private hexCache = new TtlCache<FlightState | null>(500);
  private requestCount = 0;
  remaining: number | null = null;
  lastError: string | null = null;

  constructor(readonly cfg: ProviderConfig) {}

  get id() {
    return this.cfg.id;
  }

  /** False while we're backing off from this service. */
  available(): boolean {
    return Date.now() >= this.blockedUntil;
  }

  blockedForSec(): number | null {
    const left = this.blockedUntil - Date.now();
    return left > 0 ? Math.ceil(left / 1000) : null;
  }

  private block(ms: number, reason: string) {
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + ms);
    this.lastError = reason;
    console.warn(`[${this.cfg.name}] ${reason} — pausing for ${Math.round(ms / 1000)}s`);
  }

  /** Serializes calls with a minimum gap between them. */
  private schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      if (!this.available()) throw new ProviderUnavailable(`${this.cfg.name} paused`);
      const wait = this.lastCall + this.cfg.minSpacingMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastCall = Date.now();
      if (process.env.FLIGHTX_DEBUG_HTTP) console.log(`[${this.cfg.name}] request #${++this.requestCount}`);
      return fn();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async query(url: string): Promise<FlightState[]> {
    if (!this.available()) throw new ProviderUnavailable(`${this.cfg.name} paused`);
    try {
      const { data, headers } = await this.schedule(() => fetchJson<RawResponse>(url, { timeoutMs: 12_000 }));
      this.lastError = null;
      this.trackQuota(headers);
      const now = data.now == null ? Date.now() : data.now < 1e12 ? data.now * 1000 : data.now;
      return (data.ac ?? data.aircraft ?? []).map((a) => parse(a, now, this.cfg.id)).filter((s): s is FlightState => s !== null);
    } catch (err) {
      if (err instanceof HttpError) {
        if (err.status === 429) {
          this.block(this.retryAfterMs(err.headers) ?? this.cfg.defaultBackoffMs, 'rate limited (HTTP 429)');
        } else if (err.status >= 500) {
          this.block(30_000, `server error (HTTP ${err.status})`);
        }
      } else if (!(err instanceof ProviderUnavailable)) {
        this.block(15_000, errorMessage(err));
      }
      throw err;
    }
  }

  private retryAfterMs(h: Headers): number | null {
    const retry = Number(h.get('retry-after'));
    if (Number.isFinite(retry) && retry > 0) return retry * 1000;
    const reset = Number(h.get('x-ratelimit-reset'));
    if (Number.isFinite(reset) && reset > 0) return reset * 1000;
    return null;
  }

  /**
   * Reads "x-ratelimit-remaining" and stops before a long-window (e.g. daily) budget runs out.
   * Short windows (per second) are already handled by request spacing.
   */
  private trackQuota(h: Headers) {
    const rawRemaining = h.get('x-ratelimit-remaining');
    if (rawRemaining == null) return; // header absent (Number(null) would be 0!)
    const remaining = Number(rawRemaining);
    if (!Number.isFinite(remaining)) return;
    this.remaining = remaining;
    // e.g. "500, 500;w=86400" → window of 86400 seconds
    const windowSec = Number(/w=(\d+)/.exec(h.get('x-ratelimit-limit') ?? '')?.[1] ?? NaN);
    const longWindow = !Number.isFinite(windowSec) || windowSec >= 3600;
    if (longWindow && remaining <= this.cfg.reserve) {
      this.block(this.retryAfterMs(h) ?? 3_600_000, `daily quota nearly used (${remaining} left)`);
    }
  }

  point(lat: number, lon: number, radiusNm: number): Promise<FlightState[]> {
    const r = Math.min(250, Math.max(5, Math.ceil(radiusNm)));
    return this.query(this.cfg.pointUrl(Math.round(lat * 1e3) / 1e3, Math.round(lon * 1e3) / 1e3, r));
  }

  /** One aircraft by ICAO hex. Cached 10s so a selected plane costs at most one call per 10s. */
  hex(id: string): Promise<FlightState | null> {
    return this.hexCache.getOrLoad(id, () => 10_000, async () => (await this.query(this.cfg.hexUrl(encodeURIComponent(id))))[0] ?? null);
  }

  callsign(callsign: string): Promise<FlightState[]> {
    return this.query(this.cfg.callsignUrl(encodeURIComponent(callsign)));
  }

  registration(reg: string): Promise<FlightState[]> {
    return this.query(this.cfg.registrationUrl(encodeURIComponent(reg)));
  }
}

export const adsbFi = new AdsbxProvider({
  id: 'adsbfi',
  name: 'adsb.fi',
  minSpacingMs: 1100, // published limit: 1 request/second
  defaultBackoffMs: 60_000,
  reserve: 0,
  pointUrl: (lat, lon, r) => `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${r}`,
  hexUrl: (id) => `https://opendata.adsb.fi/api/v2/hex/${id}`,
  callsignUrl: (cs) => `https://opendata.adsb.fi/api/v2/callsign/${cs}`,
  registrationUrl: (reg) => `https://opendata.adsb.fi/api/v2/registration/${reg}`,
});

export const adsbLol = new AdsbxProvider({
  id: 'adsblol',
  name: 'adsb.lol',
  minSpacingMs: 1100,
  defaultBackoffMs: 3_600_000,
  reserve: 50, // 500/day: keep some headroom
  pointUrl: (lat, lon, r) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${r}`,
  hexUrl: (id) => `https://api.adsb.lol/v2/hex/${id}`,
  callsignUrl: (cs) => `https://api.adsb.lol/v2/callsign/${cs}`,
  registrationUrl: (reg) => `https://api.adsb.lol/v2/reg/${reg}`,
});

/** Real-time providers in order of preference. */
export const REALTIME_PROVIDERS = [adsbFi, adsbLol];
