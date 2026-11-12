/**
 * Types shared by the server and the client.
 *
 * Every data source (live feeds today, the simulator later) normalizes its
 * aircraft into `FlightState`, so the map UI never needs to know where a
 * plane came from.
 */

import type { SimFlightInfo } from './sim';

/** Which world the app is showing. `sim` is reserved for the upcoming simulation mode. */
export type SourceId = 'live' | 'sim';

/** Upstream feed a particular position report came from. */
export type FeedId = 'opensky' | 'adsbfi' | 'adsblol' | 'sim';

/** Coarse aircraft class, used to pick an icon and size. */
export type AircraftKind = 'heavy' | 'jet' | 'light' | 'heli' | 'glider' | 'ground' | 'unknown';

export interface FlightState {
  /** ICAO 24-bit address as lowercase hex (e.g. "a7f4e7"). Unique per airframe. */
  id: string;
  callsign: string | null;
  lat: number;
  lon: number;
  /** Barometric altitude in feet (geometric if baro unavailable). */
  altFt: number | null;
  onGround: boolean;
  /** Ground speed in knots. */
  gsKt: number | null;
  /** True track over ground in degrees, clockwise from north. */
  trackDeg: number | null;
  /** Vertical rate in feet per minute (positive = climbing). */
  vrFpm: number | null;
  squawk: string | null;
  kind: AircraftKind;
  /** Registration / tail number when the feed provides it. */
  reg: string | null;
  /** ICAO aircraft type designator (e.g. "B738") when known. */
  typeCode: string | null;
  /** Country of registration (OpenSky only). */
  country: string | null;
  /** Epoch milliseconds when this position was measured. */
  ts: number;
  feed: FeedId;
  emergency: string | null;
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface FlightListResponse {
  flights: FlightState[];
  /** `global` = world snapshot (slower refresh), `regional` = real-time local feed. */
  mode: 'global' | 'regional';
  feeds: FeedId[];
  /** Server clock (epoch ms) — used by the client to correct for clock skew. */
  serverTime: number;
  /** Epoch ms of the newest data included. */
  updatedAt: number;
  /** When the client should poll again. */
  refreshInMs: number;
  /** Human-readable warning (rate limits, degraded feeds, …). */
  notice: string | null;
}

export interface Airport {
  icao: string | null;
  iata: string | null;
  name: string;
  city: string | null;
  country: string | null;
  lat: number;
  lon: number;
}

export interface Airline {
  name: string;
  icao: string | null;
  iata: string | null;
}

export interface FlightRoute {
  callsign: string;
  airline: Airline | null;
  origin: Airport;
  destination: Airport;
  /**
   * Route databases are keyed by callsign and are sometimes stale. This is
   * false when the aircraft's position doesn't fit the published route.
   */
  plausible: boolean;
  source: string;
}

export interface AircraftInfo {
  reg: string | null;
  typeCode: string | null;
  typeName: string | null;
  manufacturer: string | null;
  owner: string | null;
  operatorCode: string | null;
  country: string | null;
}

export interface AircraftPhoto {
  /** Small image URL. */
  thumbnail: string;
  /** Larger image URL if available. */
  large: string | null;
  /** Page to credit / link back to (required by photo providers). */
  link: string | null;
  photographer: string | null;
  source: string;
}

export interface FlightDetailResponse {
  id: string;
  state: FlightState | null;
  aircraft: AircraftInfo | null;
  route: FlightRoute | null;
  photo: AircraftPhoto | null;
  /** Present for simulated flights. */
  sim?: SimFlightInfo;
  serverTime: number;
}

export interface TrackPoint {
  /** Epoch ms. */
  t: number;
  lat: number;
  lon: number;
  altFt: number | null;
  onGround: boolean;
}

export interface TrackResponse {
  id: string;
  points: TrackPoint[];
  sources: string[];
}

export interface SearchResponse {
  results: FlightState[];
}

export interface HealthResponse {
  ok: boolean;
  opensky: {
    authenticated: boolean;
    creditsRemaining: number | null;
    snapshotAgeSec: number | null;
    snapshotSize: number;
    refreshSeconds: number;
    rateLimitedForSec: number | null;
  };
  /** Real-time providers (adsb.fi, adsb.lol) and whether they're currently paused. */
  realtime: {
    id: FeedId;
    available: boolean;
    pausedForSec: number | null;
    remaining: number | null;
    lastError: string | null;
  }[];
}
