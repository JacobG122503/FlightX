/**
 * The simulator: every flight on FlightX's map — planning, booking, spawning
 * and crashing, plus what the map, panel and search need.
 */
import path from 'node:path';
import { containsFn } from '../../lib/bounds';
import type { Airport as RouteAirport, Bounds, FlightDetailResponse, FlightListResponse, FlightState, TrackResponse } from '../../../shared/types';
import type { CrashResponse, ItineraryOption, LogFlightDetails, MissedSummary, PlanResponse, SimFlightInfo, SimStatusResponse, SimTripSummary, TimerResponse, TripView } from '../../../shared/sim';
import { capacityOf, passengerCount } from './passengers';
import { aircraftType as typeInfo } from './aircraft';
import { simData, toSimAirport, distNm, type Airport } from './data';
import { evaluateAtGate, sampleTrack } from './profile';
import { parseTripQuery, resolvePlace } from './geocode';
import { customPlaneChoices, findOptions, randomOptions, timerOption } from './planner';
import { SimStore, type LiveLeg, type StoredTrip } from './store';
import { Rng } from './random';

const PLAN_TTL_MS = 30 * 60_000;
/** Flights made from a length of time: 1 minute to 3 days. */
const TIMER_MIN = 1;
const TIMER_MAX = 72 * 60;

function dataFile(): string {
  const dir = process.env.FLIGHTX_DATA_DIR || path.resolve(process.cwd(), '.data');
  return path.join(dir, 'simulation.json');
}

export class SimSource {
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
    const region = simData().regions.get(a.region)?.name ?? null;
    return { icao: a.icao, iata: a.iata, name: a.name, city: a.city?.split(',')[0] ?? null, region, country: this.countryName(a.country), lat: a.lat, lon: a.lon };
  }

  private stateOf(l: LiveLeg, now: number): FlightState | null {
    // Only the trip's current flight is somewhere; later legs of a connection aren't yet.
    if (l.index !== l.trip.done) return null;
    const st = evaluateAtGate(l.profile, l.from, l.to, now, l.leg.seed);
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
      kind: st.phase === 'swim' ? 'swimmer' : l.type.kind,
      reg: l.leg.reg,
      typeCode: l.type.icao,
      ts: now,
      simRandom: l.trip.random,
    };
  }

  // ── Map, panel and search ────────────────────────────────────────────────
  list(bounds: Bounds): FlightListResponse {
    const now = Date.now();
    this.store.advance(now);
    this.store.touch(now);
    const inView = containsFn(bounds, 0.2);
    const flights: FlightState[] = [];
    for (const l of this.store.onMap(now)) {
      const st = this.stateOf(l, now);
      if (st && inView(st.lat, st.lon)) flights.push(st);
    }
    return { flights, serverTime: now, refreshInMs: flights.length > 5000 ? 4000 : 2000 };
  }

  detail(id: string): FlightDetailResponse {
    const now = Date.now();
    this.store.advance(now);
    const l = this.store.find(id);
    if (!l) return { id, state: null, aircraft: null, route: null, serverTime: now };
    const d = simData();
    const country = l.leg.airline.iata || l.leg.airline.icao ? (d.airlines.get(l.leg.airline.iata ?? l.leg.airline.icao ?? '')?.country ?? null) : 'United States';
    const trip = l.trip;
    const last = this.store.liveLeg(trip, trip.legs.length - 1);
    const next = l.index + 1 < trip.legs.length ? this.store.liveLeg(trip, l.index + 1) : null;
    const st = l.index === trip.done ? evaluateAtGate(l.profile, l.from, l.to, now, l.leg.seed) : null;
    const sim: SimFlightInfo = {
      tripId: trip.id,
      random: trip.random,
      legIndex: l.index,
      legCount: trip.legs.length,
      phase: st?.phase ?? 'gate',
      departAt: l.profile.departAt,
      takeoffAt: l.profile.takeoffAt,
      landAt: l.profile.landAt,
      arriveAt: l.profile.arriveAt,
      cruiseFt: l.profile.cruiseFt,
      distanceNm: Math.round(l.profile.distanceNm),
      aircraftName: `${l.type.manufacturer} ${l.type.name}`,
      wikipediaTitle: l.type.wiki || null,
      origin: toSimAirport(l.from),
      destination: toSimAirport(l.to),
      finalDestination: toSimAirport(last.to),
      nextLeg: next ? { flightNumber: next.leg.flightNumber, from: toSimAirport(next.from), to: toSimAirport(next.to), departAt: next.profile.departAt } : null,
      passengers: passengerCount(this.store.paxInput(l)),
      capacity: capacityOf(this.store.paxInput(l)),
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
      },
      sim,
      serverTime: now,
    };
  }

  track(id: string): TrackResponse {
    const l = this.store.find(id);
    if (!l) return { id, points: [] };
    return { id, points: sampleTrack(l.profile, l.from, l.to, Date.now(), l.leg.seed) };
  }

  search(raw: string): FlightState[] {
    const q = raw.trim().toUpperCase().replace(/\s+/g, '');
    if (q.length < 2) return [];
    const now = Date.now();
    const out: FlightState[] = [];
    for (const l of this.store.onMap(now)) {
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

  // ── Simulation actions ───────────────────────────────────────────────────
  /** `passengers`: send exactly this many (Advanced mode), or null for a realistic load. */
  plan(query: string, advanced: boolean, passengers: number | null = null): PlanResponse {
    const parts = parseTripQuery(query);
    const empty = (error: string, fromLabel: string | null = null, toLabel: string | null = null): PlanResponse => ({ query, fromLabel, toLabel, options: [], custom: [], error });
    if (!parts) return empty('Type a trip like “Iowa to Florida” or “Iowa City to Miami”.');
    const from = resolvePlace(parts.from);
    const to = resolvePlace(parts.to);
    if (!from) return empty(`Couldn’t find a place called “${parts.from}”.`, null, to?.label ?? null);
    if (!to) return empty(`Couldn’t find a place called “${parts.to}”.`, from.label, null);
    if (!from.airports.length || !to.airports.length) return empty('No airports with airline service found there.', from.label, to.label);
    const group = passengers && passengers > 0 ? Math.floor(passengers) : null;
    const rng = new Rng();
    const options = findOptions(from, to, { advanced, now: Date.now(), rng, passengers: group });
    // Advanced mode also offers the Custom Planes (Cessna, Concorde, B-2).
    const custom = advanced ? customPlaneChoices(from, to, group, Date.now(), rng) : [];
    if (!options.length && !custom.length) {
      const same = from.airports.length === 1 && to.airports.length === 1 && from.airports[0] === to.airports[0];
      return empty(same ? 'Those are the same airport — pick two different places.' : 'No airline flies between those places. Try Advanced mode for the Custom Planes.', from.label, to.label);
    }
    const now = Date.now();
    for (const [id, c] of this.planCache) if (now - c.at > PLAN_TTL_MS) this.planCache.delete(id);
    const cache = (opt: ItineraryOption | null) => opt && this.planCache.set(opt.id, { opt, query, at: now });
    for (const opt of options) cache(opt);
    for (const c of custom) {
      cache(c.realistic);
      cache(c.unlimited);
    }
    return { query, fromLabel: from.label, toLabel: to.label, options, custom, error: null };
  }

  book(optionId: string): SimTripSummary {
    const cached = this.planCache.get(optionId);
    if (!cached) throw new Error('That option has expired — search again.');
    const now = Date.now();
    const opt = cached.opt;
    const departures = [opt, ...(opt.extraDepartures ?? [])];
    if (departures.length === 1) {
      const [trip] = this.store.add([opt], { random: false, query: cached.query, startAt: now });
      return this.summary(trip, now);
    }
    // More passengers than one plane holds: one trip per departure.
    const trips = departures.map((dep) => this.store.add([dep], { random: false, query: cached.query, startAt: now + (dep.departAt - opt.departAt) })[0]);
    return this.summary(trips[0], now);
  }

  /** Everything known about a finished flight in the log. */
  logDetails(entryId: string): LogFlightDetails | null {
    const e = this.store.log.find((x) => x.id === entryId);
    if (!e) return null;
    const d = simData();
    const from = d.byIata.get(e.from) ?? null;
    const to = d.byIata.get(e.to) ?? null;
    const t = typeInfo(e.aircraftType);
    return {
      entry: e,
      from: from ? toSimAirport(from) : null,
      to: to ? toSimAirport(to) : null,
      aircraftName: t ? `${t.manufacturer} ${t.name}` : e.aircraftType,
      airline: e.airline,
      distanceNm: from && to ? Math.round(distNm(from, to)) : null,
    };
  }

  /** What happened between the last time FlightX was open and this launch. */
  missed(): MissedSummary {
    const store = this.store;
    store.advance(Date.now());
    const since = store.previousActiveAt;
    const empty: MissedSummary = { awayMs: 0, since, landed: 0, randomLanded: 0, bookedLanded: [], passengersDelivered: 0, stillFlying: [], stillFlyingTotal: 0, stillFlyingYours: 0 };
    if (since == null) return empty;
    const m = store.missedStats;
    const now = Date.now();
    const trips = store.allTrips();
    const finalArrive = (t: StoredTrip) => store.liveLeg(t, t.legs.length - 1).profile.arriveAt;
    const ordered = [...trips].sort((a, b) => Number(a.random) - Number(b.random) || finalArrive(a) - finalArrive(b));
    return {
      awayMs: store.loadedAt - since,
      since,
      landed: m.landed,
      randomLanded: m.random,
      bookedLanded: [...m.booked].sort((a, b) => b.at - a.at).slice(0, 30),
      passengersDelivered: m.passengers,
      stillFlying: ordered.slice(0, 60).map((t) => this.summary(t, now)),
      stillFlyingTotal: trips.length,
      stillFlyingYours: trips.filter((t) => !t.random).length,
    };
  }

  /** Simple mode: plan and immediately send the best match. */
  send(query: string): { plan: PlanResponse; trip: SimTripSummary | null } {
    const plan = this.plan(query, false);
    const best = plan.options.find((o) => o.tags.includes('best')) ?? plan.options[0];
    return { plan, trip: best ? this.book(best.id) : null };
  }

  /** Sends a random flight lasting as close as possible to `minutes`, starting right now. */
  timer(minutes: number): TimerResponse {
    const target = Math.round(Math.max(TIMER_MIN, Math.min(TIMER_MAX, Number(minutes) || 0)));
    if (!Number.isFinite(Number(minutes)) || Number(minutes) <= 0) throw new Error('Pick a length of time for the flight.');
    const now = Date.now();
    const opt = timerOption(target, now, new Rng());
    if (!opt) throw new Error('Couldn’t find a flight for that time — try another.');
    const label = target >= 60 ? `${Math.floor(target / 60)}h${target % 60 ? ` ${target % 60}m` : ''}` : `${target}m`;
    const [trip] = this.store.add([opt], { random: false, query: `${label} flight`, startAt: now });
    // Runway queues can shift the end by a minute or two; the last taxi to the gate absorbs it.
    this.store.endTripAt(trip, this.store.liveLeg(trip, 0).profile.departAt + target * 60_000);
    const summary = this.summary(trip, now);
    return { trip: summary, targetMin: target, actualMin: (summary.finalArriveAt - summary.legs[0].departAt) / 60_000 };
  }

  spawn(count: number): number {
    const n = Math.max(1, Math.floor(Number(count) || 1));
    const opts = randomOptions(n, Date.now(), new Rng());
    return this.store.add(opts, { random: true, query: null }).length;
  }

  /** Waiting at a gate (boarding, connection, fuel stop): push back into the taxi queue now. */
  nudge(id: string): { departAt: number } {
    this.store.advance(Date.now());
    const departAt = this.store.nudge(id, Date.now());
    if (departAt == null) throw new Error('Only a plane waiting at its gate can be nudged.');
    return { departAt };
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

  status(view: TripView = 'newest'): SimStatusResponse {
    const now = Date.now();
    this.store.advance(now);
    this.store.touch(now);
    const trips = this.store.allTrips();
    const finalArrive = (t: StoredTrip) => this.store.liveLeg(t, t.legs.length - 1).profile.arriveAt;
    const shown =
      view === 'booked' ? trips.filter((t) => !t.random) : view === 'random' ? trips.filter((t) => t.random) : trips;
    const sorted =
      view === 'newest'
        ? shown.sort((a, b) => b.createdAt - a.createdAt)
        : view === 'left-desc'
          ? shown.sort((a, b) => finalArrive(b) - finalArrive(a))
          : shown.sort((a, b) => finalArrive(a) - finalArrive(b));
    const recent = sorted.slice(0, 150);
    const activeFlights = [...this.store.active(now)].length;
    const log = this.store.log;
    const logSlice = log.slice(-300).reverse();
    const d = simData();
    const airports: SimStatusResponse['airports'] = {};
    const codes = new Set<string>();
    for (const t of recent) for (const l of t.legs) codes.add(l.from).add(l.to);
    for (const e of logSlice) codes.add(e.from).add(e.to);
    for (const code of codes) {
      const a = d.byIata.get(code);
      if (!a) continue;
      const region = d.regions.get(a.region)?.name;
      const country = d.countries.get(a.country)?.name ?? a.country;
      airports[code] = { name: a.name, place: [a.city?.split(',')[0], region, country].filter(Boolean).join(', '), tz: a.tz };
    }
    return {
      airports,
      trips: recent.map((t) => this.summary(t, now)),
      tripCount: trips.length,
      activeFlights,
      log: logSlice,
      logTotal: this.store.logTotal,
      serverTime: now,
    };
  }
}
