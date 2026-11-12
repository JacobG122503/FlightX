/**
 * OpenSky Network — https://opensky-network.org (free for non-commercial use).
 *
 * Used for the world-wide view: one `/states/all` call returns every aircraft
 * OpenSky can see (~9–12k). It costs 4 API credits, so we fetch a single global
 * snapshot on demand, cache it, and filter it per viewport on our side.
 * Also provides `/tracks/all`, the path flown so far for one aircraft.
 */
import { config } from '../../config';
import { fetchJson, HttpError, errorMessage } from '../../lib/http';
import { FT_PER_M, KT_PER_MS } from '../../../shared/geo';
import { cleanCallsign, guessKind, kindFromOpenSkyCategory } from '../../../shared/aircraft';
import type { FlightState, TrackPoint } from '../../../shared/types';

const API = 'https://opensky-network.org/api';
const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

/** Positions older than this (relative to the snapshot time) are dropped. */
const MAX_POSITION_AGE_SEC = 300;
/** After a non-rate-limit failure, wait this long before trying again. */
const ERROR_BACKOFF_MS = 30_000;

// prettier-ignore
type RawState = [
  icao24: string, callsign: string | null, originCountry: string, timePosition: number | null,
  lastContact: number, lon: number | null, lat: number | null, baroAltM: number | null,
  onGround: boolean, velocityMs: number | null, trueTrack: number | null, vertRateMs: number | null,
  sensors: number[] | null, geoAltM: number | null, squawk: string | null, spi: boolean,
  positionSource: number, category?: number,
];

interface RawTrack {
  icao24: string;
  callsign: string | null;
  startTime: number;
  endTime: number;
  path: [time: number, lat: number | null, lon: number | null, baroAltM: number | null, track: number | null, onGround: boolean][];
}

export interface Snapshot {
  states: FlightState[];
  byId: Map<string, FlightState>;
  /** When we fetched it (epoch ms). */
  fetchedAt: number;
  /** Data time reported by OpenSky (epoch ms). */
  dataTime: number;
}

function parseState(s: RawState, dataTimeSec: number): FlightState | null {
  const [icao24, callsignRaw, country, timePos, , lon, lat, baroAlt, onGround, vel, track, vr, , geoAlt, squawk, , , category] = s;
  if (lat == null || lon == null || timePos == null) return null;
  if (dataTimeSec - timePos > MAX_POSITION_AGE_SEC) return null;
  const altM = baroAlt ?? geoAlt;
  const altFt = altM != null ? Math.round(altM * FT_PER_M) : null;
  const gsKt = vel != null ? Math.round(vel * KT_PER_MS) : null;
  const callsign = cleanCallsign(callsignRaw);
  let kind = kindFromOpenSkyCategory(category);
  if (kind === 'unknown') kind = guessKind(callsign, gsKt, altFt);
  return {
    id: icao24.toLowerCase(),
    callsign,
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5,
    altFt: onGround ? 0 : altFt,
    onGround,
    gsKt,
    trackDeg: track != null ? Math.round(track * 10) / 10 : null,
    vrFpm: vr != null ? Math.round((vr * FT_PER_M * 60) / 10) * 10 : null,
    squawk: squawk ?? null,
    kind,
    reg: null,
    typeCode: null,
    country: country || null,
    ts: timePos * 1000,
    feed: 'opensky',
    emergency: squawk === '7500' || squawk === '7600' || squawk === '7700' ? squawk : null,
  };
}

export class OpenSkyFeed {
  private snapshot: Snapshot | null = null;
  private refreshing: Promise<void> | null = null;
  private blockedUntil = 0;
  private token: { value: string; expires: number } | null = null;
  creditsRemaining: number | null = null;
  lastError: string | null = null;

  private get refreshMs() {
    return config.opensky.refreshSeconds * 1000;
  }

  /** Current snapshot without triggering a fetch. */
  peek(): Snapshot | null {
    return this.snapshot;
  }

  /** Returns a snapshot, refreshing it first if it's stale and we're allowed to. */
  async get(): Promise<Snapshot | null> {
    const now = Date.now();
    const stale = !this.snapshot || now - this.snapshot.fetchedAt >= this.refreshMs;
    if (stale && now >= this.blockedUntil) {
      this.refreshing ??= this.refresh().finally(() => (this.refreshing = null));
      await this.refreshing;
    }
    return this.snapshot;
  }

  /** Epoch ms when the next refresh will be possible. */
  nextRefreshAt(): number {
    const due = this.snapshot ? this.snapshot.fetchedAt + this.refreshMs : Date.now();
    return Math.max(due, this.blockedUntil);
  }

  rateLimitedForSec(): number | null {
    const left = this.blockedUntil - Date.now();
    return left > 0 && this.lastError?.includes('rate limit') ? Math.ceil(left / 1000) : null;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const { clientId, clientSecret } = config.opensky;
    if (!clientId || !clientSecret) return {};
    if (!this.token || this.token.expires - 60_000 < Date.now()) {
      const { data } = await fetchJson<{ access_token: string; expires_in: number }>(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
      });
      this.token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
    }
    return { Authorization: `Bearer ${this.token.value}` };
  }

  private async refresh(): Promise<void> {
    const started = Date.now();
    try {
      const { data, headers } = await fetchJson<{ time: number; states: RawState[] | null }>(
        `${API}/states/all?extended=1`,
        { headers: await this.authHeaders(), timeoutMs: 30_000 },
      );
      const remaining = headers.get('x-rate-limit-remaining');
      if (remaining != null) this.creditsRemaining = Number(remaining);
      const states: FlightState[] = [];
      for (const raw of data.states ?? []) {
        const st = parseState(raw, data.time);
        if (st) states.push(st);
      }
      this.snapshot = { states, byId: new Map(states.map((s) => [s.id, s])), fetchedAt: started, dataTime: data.time * 1000 };
      this.lastError = null;
      console.log(`[opensky] snapshot: ${states.length} aircraft in ${Date.now() - started}ms, credits left: ${remaining ?? '?'}`);
    } catch (err) {
      if (err instanceof HttpError && err.status === 429) {
        const retry = Number(err.headers.get('x-rate-limit-retry-after-seconds'));
        const waitSec = Number.isFinite(retry) && retry > 0 ? retry : 3600;
        this.blockedUntil = Date.now() + waitSec * 1000;
        this.creditsRemaining = 0;
        this.lastError = `OpenSky rate limit reached (retry in ${Math.round(waitSec / 60)} min)`;
      } else {
        if (err instanceof HttpError && err.status === 401) this.token = null;
        this.blockedUntil = Date.now() + ERROR_BACKOFF_MS;
        this.lastError = `OpenSky unavailable: ${errorMessage(err)}`;
      }
      console.warn(`[opensky] ${this.lastError}`);
    }
  }

  /** Path flown so far on the current flight, or null if OpenSky has none. */
  async track(id: string): Promise<TrackPoint[] | null> {
    try {
      const { data } = await fetchJson<RawTrack>(`${API}/tracks/all?icao24=${encodeURIComponent(id)}&time=0`, {
        headers: await this.authHeaders(),
        timeoutMs: 20_000,
      });
      return (data.path ?? [])
        .filter((p) => p[1] != null && p[2] != null)
        .map(([t, lat, lon, alt, , onGround]) => ({
          t: t * 1000,
          lat: lat!,
          lon: lon!,
          altFt: onGround ? 0 : alt != null ? Math.round(alt * FT_PER_M) : null,
          onGround,
        }));
    } catch (err) {
      if (!(err instanceof HttpError && err.status === 404)) console.warn(`[opensky] track ${id}: ${errorMessage(err)}`);
      return null;
    }
  }
}
