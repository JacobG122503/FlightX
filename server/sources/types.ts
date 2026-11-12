import type {
  Bounds,
  FlightDetailResponse,
  FlightListResponse,
  FlightState,
  HealthResponse,
  SourceId,
  TrackResponse,
} from '../../shared/types';

/**
 * Anything that can populate the map. `LiveSource` aggregates real feeds;
 * the upcoming simulator will implement the same interface, so the HTTP API
 * and the client UI work unchanged in both modes.
 */
export interface FlightSource {
  readonly id: SourceId;
  /** Aircraft inside the viewport. */
  list(bounds: Bounds): Promise<FlightListResponse>;
  /** Latest state + aircraft/route/photo details for one aircraft. */
  detail(id: string): Promise<FlightDetailResponse>;
  /** Path flown so far. */
  track(id: string): Promise<TrackResponse>;
  /** Find aircraft by callsign, registration or ICAO hex. */
  search(query: string): Promise<FlightState[]>;
  health(): HealthResponse;
}
