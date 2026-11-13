import type { CrashResponse, LogFlightDetails, MissedSummary, PlanResponse, SimStatusResponse, SimTripSummary, TimerResponse, TripView } from '../shared/sim';
import type { Bounds, FlightDetailResponse, FlightListResponse, SearchResponse, TrackResponse } from '../shared/types';

/** Difference between the server's clock and ours, so positions use simulator time. */
let clockOffsetMs = 0;
export const serverNow = () => Date.now() + clockOffsetMs;

async function get<T>(path: string, signal?: AbortSignal, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { signal, ...init });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  const data = (await res.json()) as T & { serverTime?: number };
  // The simulator runs on this computer, so the clocks agree; only correct real skew (> 1 s).
  // Re-syncing on every response made everything hop by the response time on each refresh.
  if (typeof data.serverTime === 'number') {
    const offset = data.serverTime - Date.now();
    if (Math.abs(offset - clockOffsetMs) > 1000) clockOffsetMs = Math.abs(offset) > 1000 ? offset : 0;
  }
  return data;
}

const qs = (params: Record<string, string>) => new URLSearchParams(params).toString();

const post = <T>(path: string, body: unknown) =>
  get<T>(path, undefined, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  flights: (bounds: Bounds, signal?: AbortSignal) =>
    get<FlightListResponse>(
      `/api/flights?${qs({ bbox: [bounds.south, bounds.west, bounds.north, bounds.east].map((n) => n.toFixed(4)).join(',') })}`,
      signal,
    ),
  detail: (id: string, signal?: AbortSignal) => get<FlightDetailResponse>(`/api/flights/${encodeURIComponent(id)}`, signal),
  track: (id: string, signal?: AbortSignal) => get<TrackResponse>(`/api/flights/${encodeURIComponent(id)}/track`, signal),
  search: (q: string, signal?: AbortSignal) => get<SearchResponse>(`/api/search?${qs({ q })}`, signal),
  sim: {
    /** `passengers`: send exactly this many, or null for a realistic load on each plane. */
    plan: (query: string, advanced: boolean, passengers: number | null = null) => post<PlanResponse>('/api/sim/plan', { query, advanced, passengers }),
    send: (query: string) => post<{ plan: PlanResponse; trip: SimTripSummary | null }>('/api/sim/send', { query }),
    book: (optionId: string) => post<{ trip: SimTripSummary }>('/api/sim/book', { optionId }),
    logDetails: (entryId: string) => get<LogFlightDetails>(`/api/sim/log/${encodeURIComponent(entryId)}`),
    timer: (minutes: number) => post<TimerResponse>('/api/sim/timer', { minutes }),
    spawn: (count: number) => post<{ created: number }>('/api/sim/spawn', { count }),
    status: (view: TripView = 'newest') => get<SimStatusResponse>(`/api/sim/status?view=${view}`),
    missed: () => get<MissedSummary>('/api/sim/missed'),
    nudge: (id: string) => post<{ departAt: number }>(`/api/sim/flights/${encodeURIComponent(id)}/nudge`, {}),
    crash: (id: string) => post<CrashResponse>(`/api/sim/flights/${encodeURIComponent(id)}/crash`, {}),
    clear: () => post<{ removed: number }>('/api/sim/clear', {}),
  },
};
