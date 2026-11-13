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

/**
 * `supersonic` = Concorde / SR-71 at full speed; `refuel` = taking fuel from a tanker in mid-air;
 * `walk` / `swim` = the Walk option (swimming over water).
 */
export type SimPhase = 'gate' | 'taxi-out' | 'climb' | 'cruise' | 'supersonic' | 'refuel' | 'descent' | 'approach' | 'taxi-in' | 'walk' | 'swim';

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
  /** Custom planes with fuel set to Unlimited (no fuel stops or mid-air refuelling). */
  unlimitedFuel?: boolean;
}

export interface Layover {
  airport: SimAirport;
  minutes: number;
  /** True for a refuelling stop (custom planes). */
  fuelStop: boolean;
}

export type ItineraryTag = 'best' | 'fastest';

export interface ItineraryOption {
  id: string;
  /** Scheduled airline flights, or one of the Custom Planes (Cessna, Concorde, B-2). */
  kind: 'airline' | 'custom';
  /** Passengers you chose to send (null = a realistic load for each plane). */
  passengers: number | null;
  /** Airline itineraries with a chosen count: how many fly on this departure. */
  paxThisDeparture?: number;
  /** How many planes (custom planes) or departures (airline groups too big for one flight). */
  aircraftCount: number;
  /** Extra detail, e.g. how a big group is split up. */
  note: string | null;
  /** Airline groups too big for one flight: the later departures of the same itinerary. */
  extraDepartures?: ItineraryOption[];
  /** Custom planes: fuel setting this option was planned with. */
  fuel?: 'realistic' | 'unlimited';
  /** B-2 with realistic fuel: tanker meetups on the way. */
  aerialRefuels?: number;
  legs: ItineraryLeg[];
  departAt: number;
  arriveAt: number;
  durationMin: number;
  stops: number;
  layovers: Layover[];
  tags: ItineraryTag[];
}

export interface PlanResponse {
  query: string;
  /** What the two halves of the query were understood as, e.g. "Iowa (US state)". */
  fromLabel: string | null;
  toLabel: string | null;
  options: ItineraryOption[];
  /** Advanced mode: the Custom Planes, each planned with realistic and unlimited fuel. */
  custom: CustomPlaneChoice[];
  error: string | null;
}

export type CustomPlaneKey = 'C172' | 'CONC' | 'B2' | 'X59' | 'SR71' | 'ZEPP' | 'WALK';

/** One of the fun planes, with both fuel settings already worked out. */
export interface CustomPlaneChoice {
  key: CustomPlaneKey;
  /** e.g. "Cessna 172 Skyhawk". */
  name: string;
  /** Short spec line, e.g. "Mach 2.04 · 100 seats · 3,900 NM range". */
  summary: string;
  seats: number;
  /** Realistic fuel (stops / mid-air refuelling), or null when it can't make the trip. */
  realistic: ItineraryOption | null;
  /** Why realistic fuel can't make it (e.g. too much open ocean for a Cessna). */
  unavailable: string | null;
  /** Unlimited fuel: nonstop. */
  unlimited: ItineraryOption;
  /** False for Walk: no fuel, so the realistic/unlimited switch doesn't apply. */
  fuelApplies: boolean;
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
  /** When the whole trip ends: the last flight parked at its gate. */
  finalArriveAt: number;
}

/** A flight created from a chosen length of time. */
export interface TimerResponse {
  trip: SimTripSummary;
  targetMin: number;
  /** Pushback to parked at the final gate, after runway queues. */
  actualMin: number;
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
