/**
 * Reference data for the simulator (built by scripts/build-sim-data.mjs from
 * Virtual Radar Server standing data + OurAirports). Loaded lazily the first
 * time Simulation mode is used.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { haversineKm, KM_PER_NM } from '../../../shared/geo';
import type { SimAirport } from '../../../shared/sim';

export interface Airport extends SimAirport {
  /** Departing airline routes (2014 network) — a proxy for how busy the airport is. */
  weight: number;
  index: number;
}

export interface RouteInfo {
  to: Airport;
  /** Marketing airline codes selling this route. */
  airlines: string[];
  /** Marketing code → operating airline ICAO (e.g. UA → SKW for United Express by SkyWest). */
  operators: Map<string, string>;
}

export interface AirlineRec {
  code: string;
  name: string;
  icao: string | null;
  iata: string | null;
  country: string | null;
}

export interface PlaceRec {
  city: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
}

export interface SimData {
  airports: Airport[];
  byIata: Map<string, Airport>;
  byIcao: Map<string, Airport>;
  /** Outgoing routes per airport. */
  routes: Map<Airport, Map<Airport, RouteInfo>>;
  routeList: { from: Airport; info: RouteInfo }[];
  airlines: Map<string, AirlineRec>;
  places: PlaceRec[];
  regions: Map<string, { name: string; country: string; localCode: string }>;
  countries: Map<string, { name: string; keywords: string[] }>;
  /** Operator ICAO → aircraft types in its fleet with counts. */
  fleets: Map<string, [string, number][]>;
  /** Operator ICAO → real airframes [hex, registration, type]. */
  registry: Map<string, [string, string, string][]>;
  /** Airports with airline service, for weighted random picks. */
  flyable: Airport[];
}

// Works both from source (tsx) and from the Electron bundle (dist-electron/main.cjs).
function dataDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'server/sources/sim/dataset'),
    path.resolve(__dirname_safe(), '../server/sources/sim/dataset'),
    path.resolve(__dirname_safe(), 'dataset'),
  ];
  for (const c of candidates) {
    try {
      readFileSync(path.join(c, 'airports.json'));
      return c;
    } catch {
      /* try next */
    }
  }
  throw new Error('Simulator data not found (server/sources/sim/dataset). Run scripts/build-sim-data.mjs.');
}

/** __dirname exists in the Electron (CommonJS) bundle but not when running from source as ESM. */
function __dirname_safe(): string {
  return typeof __dirname !== 'undefined' ? __dirname : process.cwd();
}

let cached: SimData | null = null;

export function simData(): SimData {
  if (cached) return cached;
  const dir = dataDir();
  const load = <T>(name: string): T => JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as T;

  type RawAirport = [string, string | null, string, string | null, string, string, number, number, number, string | null, number];
  const airports: Airport[] = load<RawAirport[]>('airports.json').map((a, index) => ({
    iata: a[0],
    icao: a[1],
    name: a[2],
    city: a[3],
    region: a[4],
    country: a[5],
    lat: a[6],
    lon: a[7],
    elevFt: a[8],
    tz: a[9] ?? approxTz(a[7]),
    weight: a[10],
    index,
  }));
  const byIata = new Map(airports.map((a) => [a.iata, a]));
  const byIcao = new Map(airports.filter((a) => a.icao).map((a) => [a.icao as string, a]));

  const routes = new Map<Airport, Map<Airport, RouteInfo>>();
  const routeList: { from: Airport; info: RouteInfo }[] = [];
  for (const [si, di, ops] of load<[number, number, string][]>('routes.json')) {
    const from = airports[si];
    const to = airports[di];
    const operators = new Map<string, string>();
    for (const op of ops.split('|')) {
      const [marketing, operator] = op.split(':');
      if (marketing) operators.set(marketing, operator || marketing);
    }
    const info: RouteInfo = { to, airlines: [...operators.keys()], operators };
    let m = routes.get(from);
    if (!m) routes.set(from, (m = new Map()));
    m.set(to, info);
    routeList.push({ from, info });
  }

  const airlines = new Map<string, AirlineRec>();
  for (const [code, [name, icao, iata, country]] of Object.entries(load<Record<string, [string, string | null, string | null, string | null]>>('airlines.json'))) {
    airlines.set(code, { code, name, icao, iata, country });
  }

  const places = load<[string, string, string, number, number, number][]>('places.json').map(([city, region, country, lat, lon]) => ({ city, region, country, lat, lon }));
  const regions = new Map(
    Object.entries(load<Record<string, [string, string, string, string]>>('regions.json')).map(([code, [name, country, localCode]]) => [code, { name, country, localCode }]),
  );
  const countries = new Map(
    Object.entries(load<Record<string, [string, string]>>('countries.json')).map(([code, [name, keywords]]) => [
      code,
      { name, keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean) },
    ]),
  );

  cached = {
    airports,
    byIata,
    byIcao,
    routes,
    routeList,
    airlines,
    places,
    regions,
    countries,
    fleets: new Map(Object.entries(load<Record<string, Record<string, number>>>('fleets.json')).map(([op, types]) => [op, Object.entries(types)])),
    registry: new Map(Object.entries(load<Record<string, [string, string, string][]>>('registry.json'))),
    flyable: airports.filter((a) => a.weight > 0),
  };
  console.log(`[sim] loaded ${airports.length} airports, ${routeList.length} routes, ${airlines.size} airlines`);
  return cached;
}

/** Rough time zone from longitude when the dataset has none ("Etc/GMT" signs are inverted). */
function approxTz(lon: number): string {
  const offset = Math.round(lon / 15);
  if (offset === 0) return 'UTC';
  return `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
}

export const distNm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => haversineKm(a, b) / KM_PER_NM;

export function toSimAirport(a: Airport): SimAirport {
  return { iata: a.iata, icao: a.icao, name: a.name, city: a.city, region: a.region, country: a.country, lat: a.lat, lon: a.lon, elevFt: a.elevFt, tz: a.tz };
}
