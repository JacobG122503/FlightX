/** Types for Simulation mode, shared by the server (engine) and the client (sidebar, panel). */
import type { Airline } from './types';

export interface SimAirport {
  iata: string;
  icao: string | null;
  name: string;
  city: string | null;
  region: string;
  country: string;
  lat: number;
  lon: number;
  elevFt: number;
  /** IANA time zone, e.g. "America/Chicago" (null if unknown). */
  tz: string | null;
}

export type SimPhase = 'taxi-out' | 'climb' | 'cruise' | 'descent' | 'approach' | 'taxi-in';

/** One flight within an itinerary (a nonstop segment). */
export interface ItineraryLeg {
  from: SimAirport;
  to: SimAirport;
  airline: Airline;
  /** Marketing flight number, e.g. "DL 2413". */
  flightNumber: string;
  /** ATC callsign, e.g. "DAL2413" (uses the operating airline's code). */
  callsign: string;
  /** Regional partner actually flying it, e.g. "SkyWest Airlines" (null if the airline itself). */
  operatedBy: string | null;
  /** Operating airline ICAO code (for fleet and registrations). */
  operator: string | null;
  aircraftType: string;
  aircraftName: string;
  /** Pushback and gate-arrival times (epoch ms). */
  departAt: number;
  arriveAt: number;
  takeoffAt: number;
  landAt: number;
  distanceNm: number;
  cruiseFt: number;
  taxiOutMin: number;
  taxiInMin: number;
}

export interface Layover {
  airport: SimAirport;
  minutes: number;
  /** True for a technical refuelling stop (charter flights). */
  fuelStop: boolean;
}

export type ItineraryTag = 'best' | 'cheapest' | 'fastest';

export interface ItineraryOption {
  id: string;
  /** Scheduled airline flights, or a charter sized for the group. */
  kind: 'airline' | 'charter';
  /** Size of the travelling group. */
  passengers: number;
  /** Charters: how many aircraft fly together (big groups). */
  aircraftCount: number;
  /** Charters: why this aircraft / how many stops, e.g. "Sized for 150 passengers…". */
  note: string | null;
  legs: ItineraryLeg[];
  departAt: number;
  arriveAt: number;
  durationMin: number;
  stops: number;
  layovers: Layover[];
  /** Total for the whole group. */
  priceUsd: number;
  tags: ItineraryTag[];
}

export interface PlanResponse {
  query: string;
  /** What the two halves of the query were understood as, e.g. "Iowa (US state)". */
  fromLabel: string | null;
  toLabel: string | null;
  options: ItineraryOption[];
  error: string | null;
}

export interface SimTripSummary {
  id: string;
  random: boolean;
  query: string | null;
  createdAt: number;
  status: 'scheduled' | 'taxiing' | 'flying' | 'layover';
  /** Flight id currently on the map (null during layovers). */
  activeFlightId: string | null;
  activeLeg: number;
  legs: { flightId: string; callsign: string; flightNumber: string; from: string; to: string; departAt: number; arriveAt: number; aircraftType: string }[];
  /** 0–1 across the whole trip. */
  progress: number;
  finalArriveAt: number;
}

export interface SeatCabin {
  code: 'F' | 'J' | 'W' | 'Y';
  name: string;
  /** Seat letters with "-" for aisles, e.g. "ABC-DEF". */
  layout: string;
  rows: number[];
}

export interface SeatMap {
  type: string;
  decks: { name: string; cabins: SeatCabin[] }[];
  capacity: number;
}

/** A passenger you add yourself when booking (Advanced mode). */
export interface CustomPassenger {
  name: string;
  age: number;
  /** Seat label like "12C"; empty = place automatically. */
  seat: string;
}

export interface Passenger {
  seat: string;
  name: string;
  age: number;
  nationality: string;
  nationalityName: string;
  cabin: string;
  custom: boolean;
}

export interface PassengerManifest {
  flightNumber: string;
  callsign: string;
  from: string;
  to: string;
  aircraftType: string;
  aircraftName: string;
  seatMap: SeatMap;
  passengers: Passenger[];
  /** null while the flight is under way; true once landed; false if it crashed. */
  delivered: boolean | null;
}

export interface SimLogEntry {
  id: string;
  tripId: string;
  random: boolean;
  outcome: 'landed' | 'crashed';
  /** Touchdown (landed) or crash time, epoch ms. */
  at: number;
  departedAt: number;
  callsign: string;
  flightNumber: string;
  airline: string;
  from: string;
  fromCity: string | null;
  to: string;
  toCity: string | null;
  aircraftType: string;
  reg: string;
  legIndex: number;
  legCount: number;
  /** Everything needed to regenerate the passenger list. */
  paxSeed: number;
  paxCount: number;
  privateFlight?: boolean;
  custom?: CustomPassenger[];
  /** Charters carry exactly this many passengers. */
  paxTarget?: number;
}

/** How the Active flights list is filtered/sorted. */
export type TripView = 'newest' | 'booked' | 'random' | 'left-asc' | 'left-desc';

/** What happened while FlightX was closed. */
export interface MissedSummary {
  awayMs: number;
  since: number | null;
  landed: number;
  randomLanded: number;
  /** Your flights that landed while you were away (newest first). */
  bookedLanded: SimLogEntry[];
  passengersDelivered: number;
  /** Trips still under way — yours first, then random ones by arrival (capped). */
  stillFlying: SimTripSummary[];
  stillFlyingTotal: number;
  stillFlyingYours: number;
}

export interface SimStatusResponse {
  /** Airport details for codes shown in the sidebar (for hover popups). */
  airports: Record<string, { name: string; place: string; tz: string | null }>;
  trips: SimTripSummary[];
  tripCount: number;
  activeFlights: number;
  log: SimLogEntry[];
  logTotal: number;
  serverTime: number;
}

export interface SimFlightInfo {
  tripId: string;
  random: boolean;
  legIndex: number;
  legCount: number;
  phase: SimPhase;
  departAt: number;
  takeoffAt: number;
  landAt: number;
  arriveAt: number;
  cruiseFt: number;
  distanceNm: number;
  aircraftName: string;
  /** Wikipedia article for a representative photo of this aircraft type. */
  wikipediaTitle: string | null;
  origin: SimAirport;
  destination: SimAirport;
  finalDestination: SimAirport;
  nextLeg: { flightNumber: string; from: SimAirport; to: SimAirport; departAt: number } | null;
  passengers: number;
  capacity: number;
}

/** Details of a finished (landed or crashed) flight from the flight log. */
export interface LogFlightDetails {
  entry: SimLogEntry;
  from: SimAirport | null;
  to: SimAirport | null;
  aircraftName: string;
  airline: string;
  distanceNm: number | null;
}

export interface CrashResponse {
  id: string;
  lat: number;
  lon: number;
  altFt: number | null;
  trackDeg: number | null;
  kind: string;
  entry: SimLogEntry;
}
