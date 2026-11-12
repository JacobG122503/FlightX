/**
 * Live data: combines the free feeds into one view of the sky.
 *
 *  Zoomed out (viewport radius > 250 NM) → OpenSky world snapshot (every aircraft on Earth
 *                                          in one call), filtered to the viewport.
 *  Zoomed in  (viewport radius ≤ 250 NM) → real-time area data from adsb.fi (adsb.lol as
 *                                          backup), topped up with OpenSky-only aircraft.
 *  Selected aircraft                     → reuses area data when possible, otherwise a
 *                                          per-aircraft lookup at most every 10s;
 *                                          OpenSky track + adsbdb route/registry + photos.
 */
import { config } from '../../config';
import { TtlCache } from '../../lib/cache';
import { errorMessage } from '../../lib/http';
import { center, containsFn, radiusNm } from '../../lib/bounds';
import { isOnRoute } from '../../../shared/geo';
import type {
  Bounds,
  FeedId,
  FlightDetailResponse,
  FlightListResponse,
  FlightRoute,
  FlightState,
  HealthResponse,
  TrackPoint,
  TrackResponse,
} from '../../../shared/types';
import type { FlightSource } from '../types';
import { OpenSkyFeed } from './opensky';
import { RegionalFeed } from './regional';
import { PositionHistory } from './history';
import { getAircraft, getAirportDataPhoto, getPlanespottersPhoto, getRoute } from './enrichment';

/** Snapshot data older than this is not mixed into the real-time regional view. */
const SNAPSHOT_MERGE_MAX_AGE_MS = 5 * 60_000;
/** Area data this fresh is good enough for the selected aircraft (no extra request). */
const DETAIL_FROM_AREA_MAX_AGE_MS = 15_000;

function newest(states: FlightState[]): number {
  let t = 0;
  for (const s of states) if (s.ts > t) t = s.ts;
  return t;
}

function newestOf(...states: (FlightState | null | undefined)[]): FlightState | null {
  let best: FlightState | null = null;
  for (const s of states) if (s && (!best || s.ts > best.ts)) best = s;
  return best;
}

function formatAge(ms: number): string {
  const min = Math.round(ms / 60_000);
  return min < 1 ? 'under a minute' : `${min} min`;
}

/** Keeps only the current leg: from the last takeoff onward. */
function currentLeg(points: TrackPoint[]): TrackPoint[] {
  for (let i = points.length - 2; i >= 0; i--) {
    if (points[i].onGround && !points[i + 1].onGround) return points.slice(i);
  }
  return points;
}

export class LiveSource implements FlightSource {
  readonly id = 'live' as const;
  private opensky = new OpenSkyFeed();
  private regional = new RegionalFeed();
  private history = new PositionHistory();
  private trackCache = new TtlCache<TrackPoint[] | null>(500);
  private searchCache = new TtlCache<FlightState[]>(200);
  private lastRecordedSnapshot = 0;
  private lastRecordedArea = 0;

  async list(bounds: Bounds): Promise<FlightListResponse> {
    const r = radiusNm(bounds);
    return r <= config.regionalMaxRadiusNm ? this.listRegional(bounds, r) : this.listGlobal(bounds);
  }

  private recordSnapshot() {
    const snap = this.opensky.peek();
    if (snap && snap.fetchedAt !== this.lastRecordedSnapshot) {
      this.lastRecordedSnapshot = snap.fetchedAt;
      this.history.record(snap.states);
    }
  }

  private async listRegional(bounds: Bounds, r: number): Promise<FlightListResponse> {
    const area = await this.regional.area(center(bounds), r);
    if (area && area.fetchedAt !== this.lastRecordedArea) {
      this.lastRecordedArea = area.fetchedAt;
      this.history.record(area.flights);
    }

    // Without real-time data, fall back to (possibly fetching) the OpenSky snapshot.
    const snap = area ? this.opensky.peek() : await this.opensky.get();
    this.recordSnapshot();
    const merged = new Map<string, FlightState>();
    for (const s of area?.flights ?? []) merged.set(s.id, s);
    const feeds: FeedId[] = area ? [area.feed] : [];
    if (snap && Date.now() - snap.fetchedAt < SNAPSHOT_MERGE_MAX_AGE_MS) {
      const inView = containsFn(bounds, 0.1);
      let added = 0;
      for (const s of snap.states) {
        if (!merged.has(s.id) && inView(s.lat, s.lon)) {
          merged.set(s.id, s);
          added++;
        }
      }
      if (added > 0 || !area) feeds.push('opensky');
    }
    const flights = [...merged.values()];
    return {
      flights,
      mode: 'regional',
      feeds,
      serverTime: Date.now(),
      updatedAt: newest(flights),
      refreshInMs: area ? config.regionalRefreshMs : 30_000,
      notice: area
        ? null
        : 'Real-time feeds are paused (rate limit) — showing OpenSky data, which updates more slowly. They resume automatically.',
    };
  }

  private async listGlobal(bounds: Bounds): Promise<FlightListResponse> {
    const snap = await this.opensky.get();
    this.recordSnapshot();
    const now = Date.now();

    if (!snap) {
      // No world snapshot at all: show what we can around the map centre.
      const area = await this.regional.area(center(bounds), config.regionalMaxRadiusNm);
      const flights = area?.flights ?? [];
      return {
        flights,
        mode: 'global',
        feeds: area ? [area.feed] : [],
        serverTime: now,
        updatedAt: newest(flights),
        refreshInMs: 30_000,
        notice: `${this.opensky.lastError ?? 'World snapshot unavailable'}. Showing traffic within 250 NM of the map centre — zoom in for full coverage.`,
      };
    }

    const inView = containsFn(bounds, 0.15);
    const flights = snap.states.filter((s) => inView(s.lat, s.lon));
    const age = now - snap.fetchedAt;
    return {
      flights,
      mode: 'global',
      feeds: ['opensky'],
      serverTime: now,
      updatedAt: snap.dataTime,
      refreshInMs: Math.min(600_000, Math.max(5_000, this.opensky.nextRefreshAt() - now + 1_000)),
      notice: this.opensky.lastError ? `${this.opensky.lastError}. Showing data from ${formatAge(age)} ago.` : null,
    };
  }

  /** Latest state for one aircraft, spending a request only when area data doesn't have it. */
  private async liveState(id: string): Promise<FlightState | null> {
    const fromArea = this.regional.recent(id, DETAIL_FROM_AREA_MAX_AGE_MS);
    if (fromArea) return fromArea;
    const provider = this.regional.provider();
    return provider ? provider.hex(id).catch(() => null) : null;
  }

  async detail(id: string): Promise<FlightDetailResponse> {
    const [live, aircraft] = await Promise.all([
      this.liveState(id),
      getAircraft(id).catch((err) => {
        console.warn(`[adsbdb] aircraft ${id}: ${errorMessage(err)}`);
        return null;
      }),
    ]);

    let state = newestOf(live, this.opensky.peek()?.byId.get(id));
    if (state) {
      this.history.record([state]);
      if (aircraft) {
        state = { ...state, reg: state.reg ?? aircraft.info.reg, typeCode: state.typeCode ?? aircraft.info.typeCode };
      }
    }

    const callsign = state?.callsign;
    const [baseRoute, photo] = await Promise.all([
      callsign && /^[A-Z0-9]{3,8}$/.test(callsign)
        ? getRoute(callsign).catch((err) => {
            console.warn(`[adsbdb] route ${callsign}: ${errorMessage(err)}`);
            return null;
          })
        : null,
      getPlanespottersPhoto(id).then((p) => p ?? aircraft?.photo ?? getAirportDataPhoto(id)),
    ]);

    const route: FlightRoute | null =
      baseRoute && state ? { ...baseRoute, plausible: isOnRoute(baseRoute.origin, baseRoute.destination, state) } : null;

    return { id, state, aircraft: aircraft?.info ?? null, route, photo, serverTime: Date.now() };
  }

  async track(id: string): Promise<TrackResponse> {
    const fromOpenSky = await this.trackCache.getOrLoad(id, (v) => (v ? 60_000 : 120_000), () => this.opensky.track(id));
    const sources: string[] = [];
    let points: TrackPoint[] = [];
    if (fromOpenSky?.length) {
      points = fromOpenSky.slice();
      sources.push('opensky');
    }
    const lastT = points[points.length - 1]?.t ?? 0;
    const newer = this.history.get(id).filter((p) => p.t > lastT + 1000);
    if (newer.length) {
      points.push(...newer);
      sources.push('observed');
    }
    return { id, points: currentLeg(points), sources };
  }

  async search(raw: string): Promise<FlightState[]> {
    const q = raw.trim().toUpperCase().replace(/\s+/g, '');
    if (q.length < 2) return [];
    return this.searchCache.getOrLoad(q, () => 30_000, () => this.searchUncached(q));
  }

  private async searchUncached(q: string): Promise<FlightState[]> {
    const results = new Map<string, FlightState>();
    const lower = q.toLowerCase();

    // Free, local first: the world snapshot and current area data.
    for (const list of [this.regional.lastFlights(), this.opensky.peek()?.states ?? []]) {
      for (const s of list) {
        if (results.size >= 40) break;
        if (s.id === lower || s.callsign?.startsWith(q) || s.reg?.replace(/-/g, '') === q.replace(/-/g, '')) results.set(s.id, s);
      }
    }

    // One remote lookup (not three) to find aircraft the snapshot doesn't have.
    const provider = q.length >= 3 ? this.regional.provider() : null;
    if (provider) {
      try {
        const remote = /^[0-9A-F]{6}$/.test(q)
          ? [await provider.hex(lower)].filter((s): s is FlightState => s !== null)
          : /-/.test(q) || /^N\d/.test(q)
            ? await provider.registration(q)
            : await provider.callsign(q);
        for (const s of remote) results.set(s.id, s);
      } catch {
        /* provider paused or failed — local results still returned */
      }
    }

    const exact = (s: FlightState) => (s.callsign === q || s.reg?.replace(/-/g, '') === q.replace(/-/g, '') || s.id === lower ? 0 : 1);
    return [...results.values()]
      .sort((a, b) => exact(a) - exact(b) || (a.callsign ?? '').localeCompare(b.callsign ?? ''))
      .slice(0, 25);
  }

  health(): HealthResponse {
    const snap = this.opensky.peek();
    return {
      ok: true,
      opensky: {
        authenticated: config.opensky.authenticated,
        creditsRemaining: this.opensky.creditsRemaining,
        snapshotAgeSec: snap ? Math.round((Date.now() - snap.fetchedAt) / 1000) : null,
        snapshotSize: snap?.states.length ?? 0,
        refreshSeconds: config.opensky.refreshSeconds,
        rateLimitedForSec: this.opensky.rateLimitedForSec(),
      },
      realtime: this.regional.status(),
    };
  }
}
