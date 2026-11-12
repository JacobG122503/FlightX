import type { CrashResponse, CustomPassenger, LogFlightDetails, MissedSummary, PassengerManifest, PlanResponse, SeatMap, SimStatusResponse, SimTripSummary, TimerResponse, TripView } from '../shared/sim';
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
  if (typeof data.serverTime === 'number') clockOffsetMs = data.serverTime - Date.now();
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
    plan: (query: string, advanced: boolean, passengers = 1) => post<PlanResponse>('/api/sim/plan', { query, advanced, passengers }),
    send: (query: string) => post<{ plan: PlanResponse; trip: SimTripSummary | null }>('/api/sim/send', { query }),
    book: (optionId: string, passengers: CustomPassenger[] = []) => post<{ trip: SimTripSummary }>('/api/sim/book', { optionId, passengers }),
    passengers: (id: string) => get<PassengerManifest>(`/api/sim/flights/${encodeURIComponent(id)}/passengers`),
    logDetails: (entryId: string) => get<LogFlightDetails>(`/api/sim/log/${encodeURIComponent(entryId)}`),
    logPassengers: (entryId: string) => get<PassengerManifest>(`/api/sim/log/${encodeURIComponent(entryId)}/passengers`),
    seatMap: (type: string, charter: boolean) => get<SeatMap>(`/api/sim/seatmap/${encodeURIComponent(type)}?charter=${charter ? 1 : 0}`),
    randomPerson: () => get<{ name: string; age: number }>('/api/sim/random-person'),
    timer: (minutes: number) => post<TimerResponse>('/api/sim/timer', { minutes }),
    spawn: (count: number) => post<{ created: number }>('/api/sim/spawn', { count }),
    status: (view: TripView = 'newest') => get<SimStatusResponse>(`/api/sim/status?view=${view}`),
    missed: () => get<MissedSummary>('/api/sim/missed'),
    crash: (id: string) => post<CrashResponse>(`/api/sim/flights/${encodeURIComponent(id)}/crash`, {}),
    clear: () => post<{ removed: number }>('/api/sim/clear', {}),
  },
};
