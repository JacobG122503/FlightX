/**
 * Real-time traffic for zoomed-in views, spending as few requests as possible.
 *
 * Each fetch asks for a circle somewhat larger than the viewport. While the
 * result is fresh and the viewport still fits inside that circle (small pans,
 * zooming in), it's reused instead of making another request. Providers are
 * tried in order; one that is rate-limited is skipped until it recovers.
 */
import { haversineKm, KM_PER_NM, type LatLon } from '../../../shared/geo';
import type { FeedId, FlightState } from '../../../shared/types';
import { REALTIME_PROVIDERS, type AdsbxProvider } from './adsbx';

/** Cached area data younger than this is reused instead of refetched. */
const FRESH_MS = 6_000;
/** If every provider is paused, area data up to this old is still better than nothing. */
const STALE_OK_MS = 60_000;

export interface AreaResult {
  center: LatLon;
  radiusNm: number;
  fetchedAt: number;
  flights: FlightState[];
  byId: Map<string, FlightState>;
  feed: FeedId;
}

export class RegionalFeed {
  private last: AreaResult | null = null;
  private inflight: Promise<AreaResult | null> | null = null;

  constructor(private readonly providers: AdsbxProvider[] = REALTIME_PROVIDERS) {}

  private covers(area: AreaResult, center: LatLon, radiusNm: number): boolean {
    return haversineKm(area.center, center) / KM_PER_NM + radiusNm <= area.radiusNm;
  }

  /** Aircraft around `center` covering at least `viewRadiusNm`, or null if no provider is usable. */
  async area(center: LatLon, viewRadiusNm: number): Promise<AreaResult | null> {
    const now = Date.now();
    const last = this.last;
    if (last && now - last.fetchedAt < FRESH_MS && this.covers(last, center, viewRadiusNm)) return last;

    if (this.inflight) {
      const shared = await this.inflight;
      if (shared && this.covers(shared, center, viewRadiusNm)) return shared;
    }

    this.inflight = this.fetch(center, viewRadiusNm).finally(() => (this.inflight = null));
    const fresh = await this.inflight;
    if (fresh) return fresh;
    // Every provider paused or failing: fall back to recent data if it still covers the view.
    return last && now - last.fetchedAt < STALE_OK_MS && this.covers(last, center, viewRadiusNm) ? last : null;
  }

  private async fetch(center: LatLon, viewRadiusNm: number): Promise<AreaResult | null> {
    // A bit of margin so panning around reuses this result.
    const radiusNm = Math.min(250, Math.max(viewRadiusNm + 15, viewRadiusNm * 1.5 + 10));
    for (const p of this.providers) {
      if (!p.available()) continue;
      try {
        const flights = await p.point(center.lat, center.lon, radiusNm);
        this.last = { center, radiusNm, fetchedAt: Date.now(), flights, byId: new Map(flights.map((f) => [f.id, f])), feed: p.id };
        return this.last;
      } catch {
        /* provider logs and pauses itself; try the next one */
      }
    }
    return null;
  }

  /** A recently seen state for one aircraft from area data, if fresh enough. */
  recent(id: string, maxAgeMs: number): FlightState | null {
    const last = this.last;
    if (!last || Date.now() - last.fetchedAt > maxAgeMs) return null;
    return last.byId.get(id) ?? null;
  }

  /** Aircraft from the most recent area fetch (any age). */
  lastFlights(): FlightState[] {
    return this.last?.flights ?? [];
  }

  /** First provider that is currently usable (for per-aircraft lookups and search). */
  provider(): AdsbxProvider | null {
    return this.providers.find((p) => p.available()) ?? null;
  }

  status() {
    return this.providers.map((p) => ({
      id: p.id,
      available: p.available(),
      pausedForSec: p.blockedForSec(),
      remaining: p.remaining,
      lastError: p.lastError,
    }));
  }
}
