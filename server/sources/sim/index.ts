/**
 * Simulation mode: a separate world of simulated flights that implements the
 * same FlightSource interface as live data, so the map, panel, search and
 * status bar all work unchanged — plus planning, booking, spawning and crashing.
 */
import path from 'node:path';
import { containsFn } from '../../lib/bounds';
import type { Airport as RouteAirport, Bounds, FlightDetailResponse, FlightListResponse, FlightState, HealthResponse, TrackResponse } from '../../../shared/types';
import type { CrashResponse, CustomPassenger, ItineraryOption, PassengerManifest, PlanResponse, SeatMap, SimFlightInfo, SimStatusResponse, SimTripSummary } from '../../../shared/sim';
import { mapFor, passengerCount, passengerList } from './passengers';
import { aircraftType as typeInfo } from './aircraft';
import { person } from './names';
import type { FlightSource } from '../types';
import { simData, toSimAirport, type Airport } from './data';
import { evaluate, sampleTrack } from './profile';
import { parseTripQuery, resolvePlace } from './geocode';
import { findOptions, randomOptions } from './planner';
import { SimStore, type LiveLeg, type StoredTrip } from './store';
import { Rng } from './random';

const MAX_SPAWN = 10_000;
const MAX_ACTIVE_TRIPS = 25_000;
const PLAN_TTL_MS = 30 * 60_000;

function dataFile(): string {
  const dir = process.env.FLIGHTX_DATA_DIR || path.resolve(process.cwd(), '.data');
  return path.join(dir, 'simulation.json');
}

export class SimSource implements FlightSource {
  readonly id = 'sim' as const;
  private storeInstance: SimStore | null = null;
  private planCache = new Map<string, { opt: ItineraryOption; query: string; at: number }>();

  private get store(): SimStore {
    if (!this.storeInstance) {
      simData();
      this.storeInstance = new SimStore(dataFile());
      // Log landings even when nobody is looking at the map.
      setInterval(() => this.storeInstance?.advance(Date.now()), 15_000).unref();
    }
    return this.storeInstance;
  }

  private countryName(code: string): string {
    return simData().countries.get(code)?.name ?? code;
  }

  private routeAirport(a: Airport): RouteAirport {
    return { icao: a.icao, iata: a.iata, name: a.name, city: a.city?.split(',')[0] ?? null, country: this.countryName(a.country), lat: a.lat, lon: a.lon };
  }

  private stateOf(l: LiveLeg, now: number): FlightState | null {
    const st = evaluate(l.profile, l.from, l.to, now, l.leg.seed);
    if (!st) return null;
    return {
      id: l.leg.id,
      callsign: l.leg.callsign,
      lat: Math.round(st.lat * 1e5) / 1e5,
      lon: Math.round(st.lon * 1e5) / 1e5,
      altFt: st.onGround ? 0 : st.altFt,
      onGround: st.onGround,
      gsKt: st.gsKt,
      trackDeg: st.trackDeg,
      vrFpm: st.onGround ? 0 : st.vrFpm,
      squawk: l.leg.squawk,
      kind: l.type.kind,
      reg: l.leg.reg,
      typeCode: l.type.icao,
      country: null,
      ts: now,
      feed: 'sim',
      emergency: null,
    };
  }

  // ── FlightSource ─────────────────────────────────────────────────────────
  async list(bounds: Bounds): Promise<FlightListResponse> {
    const now = Date.now();
    this.store.advance(now);
    const inView = containsFn(bounds, 0.2);
    const flights: FlightState[] = [];
    for (const l of this.store.active(now)) {
      const st = this.stateOf(l, now);
      if (st && inView(st.lat, st.lon)) flights.push(st);
    }
    return { flights, mode: 'regional', feeds: ['sim'], serverTime: now, updatedAt: now, refreshInMs: flights.length > 5000 ? 4000 : 2000, notice: null };
  }

  async detail(id: string): Promise<FlightDetailResponse> {
    const now = Date.now();
    this.store.advance(now);
    const l = this.store.find(id);
    if (!l) return { id, state: null, aircraft: null, route: null, photo: null, serverTime: now };
    const d = simData();
    const country = l.leg.airline.iata || l.leg.airline.icao ? (d.airlines.get(l.leg.airline.iata ?? l.leg.airline.icao ?? '')?.country ?? null) : 'United States';
    const trip = l.trip;
    const last = this.store.liveLeg(trip, trip.legs.length - 1);
    const next = l.index + 1 < trip.legs.length ? this.store.liveLeg(trip, l.index + 1) : null;
    const st = evaluate(l.profile, l.from, l.to, now, l.leg.seed);
    const sim: SimFlightInfo = {
      tripId: trip.id,
      random: trip.random,
      legIndex: l.index,
      legCount: trip.legs.length,
      phase: st?.phase ?? 'taxi-out',
      departAt: l.profile.departAt,
      takeoffAt: l.profile.takeoffAt,
      landAt: l.profile.landAt,
      arriveAt: l.profile.arriveAt,
      cruiseFt: l.profile.cruiseFt,
      distanceNm: Math.round(l.profile.distanceNm),
      aircraftName: `${l.type.manufacturer} ${l.type.name}`,
      wikipediaTitle: l.type.wiki,
      origin: toSimAirport(l.from),
      destination: toSimAirport(l.to),
      finalDestination: toSimAirport(last.to),
      nextLeg: next ? { flightNumber: next.leg.flightNumber, from: toSimAirport(next.from), to: toSimAirport(next.to), departAt: next.profile.departAt } : null,
      passengers: passengerCount(this.store.paxInput(l)),
      capacity: mapFor(this.store.paxInput(l)).capacity,
    };
    return {
      id,
      state: this.stateOf(l, now),
      aircraft: {
        reg: l.leg.reg,
        typeCode: l.type.icao,
        typeName: l.type.name,
        manufacturer: l.type.manufacturer,
        owner: l.leg.operatedBy ?? l.leg.airline.name,
        operatorCode: l.leg.airline.icao,
        country,
      },
      route: {
        callsign: l.leg.callsign,
        airline: trip.kind === 'charter' ? null : l.leg.airline,
        origin: this.routeAirport(l.from),
        destination: this.routeAirport(l.to),
        plausible: true,
        source: 'FlightX simulator',
      },
      photo: null,
      sim,
      serverTime: now,
    };
  }

  async track(id: string): Promise<TrackResponse> {
    const l = this.store.find(id);
    if (!l) return { id, points: [], sources: [] };
    return { id, points: sampleTrack(l.profile, l.from, l.to, Date.now(), l.leg.seed), sources: ['sim'] };
  }

  async search(raw: string): Promise<FlightState[]> {
    const q = raw.trim().toUpperCase().replace(/\s+/g, '');
    if (q.length < 2) return [];
    const now = Date.now();
    const out: FlightState[] = [];
    for (const l of this.store.active(now)) {
      const hit =
        l.leg.callsign.startsWith(q) ||
        l.leg.flightNumber.replace(/\s+/g, '').startsWith(q) ||
        l.leg.reg.replace(/-/g, '') === q.replace(/-/g, '') ||
        l.leg.id.toUpperCase() === q ||
        l.from.iata === q ||
        l.to.iata === q;
      if (!hit) continue;
      const st = this.stateOf(l, now);
      if (st) out.push(st);
      if (out.length >= 25) break;
    }
    return out;
  }

  health(): HealthResponse {
    return {
      ok: true,
      opensky: { authenticated: false, creditsRemaining: null, snapshotAgeSec: null, snapshotSize: 0, refreshSeconds: 0, rateLimitedForSec: null },
      realtime: [],
    };
  }

  // ── Simulation actions ───────────────────────────────────────────────────
  plan(query: string, advanced: boolean, passengers = 1): PlanResponse {
    const parts = parseTripQuery(query);
    const empty = (error: string, fromLabel: string | null = null, toLabel: string | null = null): PlanResponse => ({ query, fromLabel, toLabel, options: [], error });
    if (!parts) return empty('Type a trip like “Iowa to Florida” or “Iowa City to Miami”.');
    const from = resolvePlace(parts.from);
    const to = resolvePlace(parts.to);
    if (!from) return empty(`Couldn’t find a place called “${parts.from}”.`, null, to?.label ?? null);
    if (!to) return empty(`Couldn’t find a place called “${parts.to}”.`, from.label, null);
    if (!from.airports.length || !to.airports.length) return empty('No airports with airline service found there.', from.label, to.label);
    const options = findOptions(from, to, { advanced, now: Date.now(), rng: new Rng(), passengers: Math.max(1, Math.min(5000, Math.floor(passengers) || 1)) });
    if (!options.length) return empty('Those are the same airport — pick two different places.', from.label, to.label);
    const now = Date.now();
    for (const [id, c] of this.planCache) if (now - c.at > PLAN_TTL_MS) this.planCache.delete(id);
    for (const opt of options) this.planCache.set(opt.id, { opt, query, at: now });
    return { query, fromLabel: from.label, toLabel: to.label, options, error: null };
  }

  private ensureCapacity(n: number) {
    if (this.store.tripCount + n > MAX_ACTIVE_TRIPS) {
      throw new Error(`That would make ${this.store.tripCount + n} active trips; the limit is ${MAX_ACTIVE_TRIPS.toLocaleString()}.`);
    }
  }

  book(optionId: string, passengers: CustomPassenger[] = []): SimTripSummary {
    const cached = this.planCache.get(optionId);
    if (!cached) throw new Error('That option has expired — search again.');
    this.ensureCapacity(cached.opt.aircraftCount);
    const custom = passengers.filter((p) => p && typeof p.name === 'string').slice(0, 5000);
    const [trip] = this.store.add([cached.opt], { random: false, query: cached.query, startAt: Date.now(), passengers: custom });
    return this.summary(trip, Date.now());
  }

  /** Everyone on board a flight that's currently running. */
  passengers(flightId: string): PassengerManifest | null {
    const l = this.store.find(flightId);
    if (!l) return null;
    const input = this.store.paxInput(l);
    return {
      flightNumber: l.leg.flightNumber,
      callsign: l.leg.callsign,
      from: l.from.iata,
      to: l.to.iata,
      aircraftType: l.type.icao,
      aircraftName: `${l.type.manufacturer} ${l.type.name}`,
      seatMap: mapFor(input),
      passengers: passengerList(input),
      delivered: null,
    };
  }

  /** Passengers of a finished flight from the flight log (regenerated from its seed). */
  logPassengers(entryId: string): PassengerManifest | null {
    const e = this.store.log.find((x) => x.id === entryId);
    if (!e) return null;
    const d = simData();
    const from = d.byIata.get(e.from);
    const to = d.byIata.get(e.to);
    if (!from || !to) return null;
    const t = typeInfo(e.aircraftType);
    const input = { seed: e.paxSeed, type: e.aircraftType, kind: t?.kind ?? 'jet', privateFlight: Boolean(e.privateFlight), custom: e.custom ?? [], from, to, target: e.paxTarget };
    return {
      flightNumber: e.flightNumber,
      callsign: e.callsign,
      from: e.from,
      to: e.to,
      aircraftType: e.aircraftType,
      aircraftName: t ? `${t.manufacturer} ${t.name}` : e.aircraftType,
      seatMap: mapFor(input),
      passengers: passengerList(input),
      delivered: e.outcome === 'landed',
    };
  }

  seatMapFor(type: string, charter: boolean): SeatMap {
    const t = typeInfo(type);
    return mapFor({ type: t?.icao ?? type, kind: t?.kind ?? 'jet', privateFlight: charter });
  }

  randomPerson(): { name: string; age: number } {
    const d = simData();
    const a = d.flyable[Math.floor(Math.random() * Math.min(400, d.flyable.length))];
    const p = person(a.country, a.country, new Rng());
    return { name: p.name, age: p.age < 18 ? p.age + 18 : p.age };
  }

  /** Simple mode: plan and immediately send the best match. */
  send(query: string): { plan: PlanResponse; trip: SimTripSummary | null } {
    const plan = this.plan(query, false);
    const best = plan.options.find((o) => o.tags.includes('best')) ?? plan.options[0];
    return { plan, trip: best ? this.book(best.id) : null };
  }

  spawn(count: number): number {
    const n = Math.max(1, Math.min(MAX_SPAWN, Math.floor(count)));
    this.ensureCapacity(n);
    const opts = randomOptions(n, Date.now(), new Rng());
    return this.store.add(opts, { random: true, query: null }).length;
  }

  crash(id: string): CrashResponse | null {
    const res = this.store.crash(id, Date.now());
    if (!res) return null;
    return { id, lat: res.lat, lon: res.lon, altFt: res.altFt, trackDeg: res.trackDeg, kind: res.live.type.kind, entry: res.entry };
  }

  clear(): number {
    return this.store.clear();
  }

  private summary(trip: StoredTrip, now: number): SimTripSummary {
    const index = Math.min(trip.done, trip.legs.length - 1);
    const l = this.store.liveLeg(trip, index);
    const first = this.store.liveLeg(trip, 0).profile;
    const last = this.store.liveLeg(trip, trip.legs.length - 1).profile;
    const p = l.profile;
    const status: SimTripSummary['status'] =
      now < p.departAt ? (index > 0 ? 'layover' : 'scheduled') : now < p.takeoffAt || now >= p.landAt ? 'taxiing' : 'flying';
    return {
      id: trip.id,
      random: trip.random,
      query: trip.query,
      createdAt: trip.createdAt,
      status,
      activeFlightId: now >= p.departAt && now < p.arriveAt ? l.leg.id : null,
      activeLeg: index,
      legs: trip.legs.map((leg, i) => {
        const ll = this.store.liveLeg(trip, i);
        return { flightId: leg.id, callsign: leg.callsign, flightNumber: leg.flightNumber, from: leg.from, to: leg.to, departAt: ll.profile.departAt, arriveAt: ll.profile.arriveAt, aircraftType: ll.type.icao };
      }),
      progress: Math.min(1, Math.max(0, (now - first.departAt) / (last.arriveAt - first.departAt))),
      finalArriveAt: last.arriveAt,
    };
  }

  status(): SimStatusResponse {
    const now = Date.now();
    this.store.advance(now);
    const trips = this.store.allTrips();
    const recent = trips.sort((a, b) => b.createdAt - a.createdAt).slice(0, 150);
    const activeFlights = [...this.store.active(now)].length;
    const log = this.store.log;
    return {
      trips: recent.map((t) => this.summary(t, now)),
      tripCount: trips.length,
      activeFlights,
      log: log.slice(-300).reverse(),
      logTotal: log.length,
      serverTime: now,
    };
  }
}
