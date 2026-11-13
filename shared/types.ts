/**
 * Types shared by the server and the client: the map, panel and search all work
 * with `FlightState` snapshots of simulated aircraft.
 */

import type { SimFlightInfo } from './sim';

/**
 * Coarse aircraft class, used to pick an icon. Custom planes: `delta` = Concorde, `wing` = B-2,
 * `needle` = X-59, `blackbird` = SR-71, `airship` = Hindenburg, `walker` / `swimmer` = Walk.
 */
export type AircraftKind =
  | 'heavy' | 'jet' | 'light' | 'heli' | 'glider' | 'ground'
  | 'delta' | 'wing' | 'needle' | 'blackbird' | 'airship' | 'walker' | 'swimmer'
  | 'unknown';

export interface FlightState {
  /** 24-bit aircraft address as lowercase hex (e.g. "a7f4e7"). Unique per airframe. */
  id: string;
  callsign: string | null;
  lat: number;
  lon: number;
  /** Altitude in feet. */
  altFt: number | null;
  onGround: boolean;
  /** Ground speed in knots. */
  gsKt: number | null;
  /** Track over ground in degrees, clockwise from north. */
  trackDeg: number | null;
  /** Vertical rate in feet per minute (positive = climbing). */
  vrFpm: number | null;
  squawk: string | null;
  kind: AircraftKind;
  /** Registration / tail number. */
  reg: string | null;
  /** ICAO aircraft type designator (e.g. "B738"). */
  typeCode: string | null;
  /** Epoch milliseconds of this position. */
  ts: number;
  /** True if randomly spawned, false if you sent it. */
  simRandom?: boolean;
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface FlightListResponse {
  flights: FlightState[];
  /** Server clock (epoch ms) — used by the client to correct for clock skew. */
  serverTime: number;
  /** When the client should poll again. */
  refreshInMs: number;
}

export interface Airport {
  icao: string | null;
  iata: string | null;
  name: string;
  city: string | null;
  /** State / province. */
  region: string | null;
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
  /** Page the photo comes from. */
  link: string | null;
  source: string;
}

export interface FlightDetailResponse {
  id: string;
  state: FlightState | null;
  aircraft: AircraftInfo | null;
  route: FlightRoute | null;
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
}

export interface SearchResponse {
  results: FlightState[];
}
