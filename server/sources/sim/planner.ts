/**
 * Trip planning, like a flight-booking site: finds nonstop, one-stop and
 * two-stop itineraries on the real airline network, keeps airlines/alliances
 * consistent, schedules realistic connections and picks a "Best match" — plus
 * the Custom Planes (Cessna, Concorde, B-2, X-59) with fuel stops as needed.
 */
import { bearingDeg, intermediatePoint } from '../../../shared/geo';
import type { Airline } from '../../../shared/types';
import type { CustomPlaneChoice, ItineraryLeg, ItineraryOption, Layover } from '../../../shared/sim';
import { simData, distNm, toSimAirport, type Airport, type AirlineRec, type SimData } from './data';
import { AIRCRAFT, cruiseAltitude, typeFromFleet, type AircraftType } from './aircraft';
import { seatCapacity } from './seatmaps';
import { buildProfile } from './profile';
import { baseTaxiMin } from './runways';
import { Rng, newId } from './random';
import { b2RefuelCount, CUSTOM_PLANES, sr71MidRefuels, type CustomPlaneSpec } from './custom-planes';
import type { Place } from './geocode';

const ALLIANCES: Record<string, string[]> = {
  'Star Alliance': ['A3', 'AC', 'AI', 'NZ', 'NH', 'OZ', 'OS', 'AV', 'SN', 'CM', 'OU', 'MS', 'ET', 'BR', 'LO', 'LH', 'SK', 'ZH', 'SQ', 'SA', 'LX', 'TP', 'TG', 'TK', 'UA', 'CA'],
  oneworld: ['AA', 'BA', 'CX', 'AY', 'IB', 'JL', 'MH', 'QF', 'QR', 'RJ', 'AT', 'UL', 'AS', 'US', 'LA', 'S7'],
  SkyTeam: ['SU', 'AR', 'AM', 'UX', 'AF', 'CI', 'MU', 'OK', 'DL', 'GA', 'KQ', 'KL', 'KE', 'ME', 'SV', 'RO', 'VN', 'MF', 'AZ', 'CZ'],
};
/** Point-to-point carriers that don't sell connecting itineraries. */
const POINT_TO_POINT = new Set(['G4', 'SY', 'XP', 'MX']);

type Path = Airport[];

/** Big airline groups: one departure of the same itinerary every this often. */
const GROUP_DEPARTURE_GAP_MS = 45 * 60_000;

/** Fast weighted picks over many items (cumulative sums + binary search). */
class WeightedPicker<T> {
  private cum: number[] = [];
  constructor(
    private items: T[],
    weight: (t: T) => number,
  ) {
    let total = 0;
    for (const it of items) this.cum.push((total += Math.max(0, weight(it))));
  }
  pick(rng: Rng): T {
    const r = rng.next() * this.cum[this.cum.length - 1];
    let lo = 0;
    let hi = this.cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return this.items[lo];
  }
}

let airportPicker: WeightedPicker<Airport> | null = null;

function findPaths(d: SimData, o: Airport, dst: Airport): Path[] {
  const out = d.routes.get(o);
  if (!out || o === dst) return [];
  const direct = distNm(o, dst);
  const paths: Path[] = [];
  if (out.has(dst)) paths.push([o, dst]);

  const ones: { p: Path; cost: number }[] = [];
  for (const h of out.keys()) {
    if (h === dst || !d.routes.get(h)?.has(dst)) continue;
    const len = distNm(o, h) + distNm(h, dst);
    if (len > direct * 1.3 + 150) continue;
    ones.push({ p: [o, h, dst], cost: len - Math.min(h.weight, 400) * 0.6 });
  }
  ones.sort((a, b) => a.cost - b.cost);
  paths.push(...ones.slice(0, 8).map((x) => x.p));

  if (paths.length < 2) {
    const twos: { p: Path; cost: number }[] = [];
    const hubs = [...out.keys()].filter((h) => h !== dst).sort((a, b) => b.weight - a.weight).slice(0, 25);
    for (const h1 of hubs) {
      for (const h2 of d.routes.get(h1)?.keys() ?? []) {
        if (h2 === o || h2 === dst || h2 === h1 || !d.routes.get(h2)?.has(dst)) continue;
        const len = distNm(o, h1) + distNm(h1, h2) + distNm(h2, dst);
        if (len > direct * 1.35 + 200) continue;
        twos.push({ p: [o, h1, h2, dst], cost: len - (h1.weight + h2.weight) * 0.3 });
      }
    }
    twos.sort((a, b) => a.cost - b.cost);
    paths.push(...twos.slice(0, 4).map((x) => x.p));
  }
  return paths;
}

/** Airline per leg: the same airline throughout if possible, else one alliance, else mixed. */
function airlineVariants(d: SimData, path: Path): { codes: string[]; mixed: boolean }[] {
  const all = path.slice(1).map((to, i) => d.routes.get(path[i])!.get(to)!);
  // Connections can't be sold on point-to-point carriers.
  const legs = all.length > 1 ? all.map((l) => ({ ...l, airlines: l.airlines.filter((a) => !POINT_TO_POINT.has(a)) })) : all;
  if (legs.some((l) => l.airlines.length === 0)) return [];
  const common = legs.reduce<string[]>((acc, l) => acc.filter((a) => l.airlines.includes(a)), legs[0].airlines);
  const variants = common.slice(0, 2).map((a) => ({ codes: legs.map(() => a), mixed: false }));
  if (!variants.length) {
    for (const members of Object.values(ALLIANCES)) {
      const codes = legs.map((l) => l.airlines.find((a) => members.includes(a)));
      if (codes.every(Boolean)) {
        variants.push({ codes: codes as string[], mixed: false });
        break;
      }
    }
  }
  if (!variants.length) variants.push({ codes: legs.map((l) => l.airlines[0]), mixed: true });
  return variants;
}

function airlineOf(rec: AirlineRec | undefined, code: string): Airline {
  return {
    name: rec?.name ?? code,
    iata: code.length === 2 ? code : null,
    icao: rec?.icao ?? (code.length === 3 ? code : null),
  };
}

interface Operation {
  /** Operating airline ICAO (callsign prefix, fleet, registrations). */
  operator: string | null;
  operatedBy: string | null;
}

function buildLeg(
  o: Airport,
  dst: Airport,
  airline: Airline,
  type: AircraftType,
  departAt: number,
  rng: Rng,
  privateFlight = false,
  op: Operation = { operator: null, operatedBy: null },
  unlimitedFuel = false,
): ItineraryLeg {
  const distance = distNm(o, dst);
  const cruise = cruiseAltitude(type, bearingDeg(o, dst), distance, rng);
  // Lone-plane taxi times; the store adds runway queueing when the flight is booked.
  // Walkers just set off (no taxiing).
  const walking = type.icao === 'WALK';
  const taxiOutMin = walking ? 0 : baseTaxiMin(o, rng);
  const taxiInMin = walking ? 0 : baseTaxiMin(dst, rng);
  const prof = buildProfile({ from: o, to: dst, type, cruiseFt: cruise, departAt, taxiOutMin, taxiInMin, unlimitedFuel });
  const num = type.regional ? rng.int(3000, 5999) : rng.int(1, 2999);
  const code = airline.iata ?? airline.icao ?? 'ZZ';
  return {
    from: toSimAirport(o),
    to: toSimAirport(dst),
    airline,
    flightNumber: privateFlight ? 'Private' : `${code} ${num}`,
    callsign: privateFlight ? '' : `${op.operator ?? airline.icao ?? code}${num}`,
    operatedBy: op.operatedBy,
    operator: op.operator,
    aircraftType: type.icao,
    aircraftName: `${type.manufacturer} ${type.name}`,
    departAt,
    arriveAt: prof.arriveAt,
    takeoffAt: prof.takeoffAt,
    landAt: prof.landAt,
    distanceNm: Math.round(distance),
    cruiseFt: prof.cruiseFt,
    taxiOutMin,
    taxiInMin,
    ...(unlimitedFuel ? { unlimitedFuel: true } : {}),
  };
}

/** Quick turns for the sim: a connection never takes more than 10 minutes at the gate. */
function connectionMinutes(prev: ItineraryLeg, next: { from: Airport; to: Airport }, rng: Rng): number {
  const international = prev.from.country !== prev.to.country || next.from.country !== next.to.country;
  return international ? rng.int(7, 10) : rng.int(5, 10);
}

function finish(
  kind: ItineraryOption['kind'],
  legs: ItineraryLeg[],
  layovers: Layover[],
  group: { passengers: number | null; aircraftCount?: number; note?: string | null } = { passengers: null },
): ItineraryOption {
  const departAt = legs[0].departAt;
  const arriveAt = legs[legs.length - 1].arriveAt;
  return {
    id: newId(),
    kind,
    passengers: group.passengers,
    aircraftCount: group.aircraftCount ?? 1,
    note: group.note ?? null,
    legs,
    departAt,
    arriveAt,
    durationMin: Math.round((arriveAt - departAt) / 60_000),
    stops: legs.length - 1,
    layovers,
    tags: [],
  };
}

/** `types`: aircraft per leg to use (later departures of a big group fly the same planes). */
function airlineOption(d: SimData, path: Path, variant: { codes: string[] }, start: number, rng: Rng, types?: string[]): ItineraryOption {
  const legs: ItineraryLeg[] = [];
  const layovers: Layover[] = [];
  let t = start;
  for (let i = 0; i < path.length - 1; i++) {
    const o = path[i];
    const dst = path[i + 1];
    const info = d.routes.get(o)!.get(dst)!;
    const code = variant.codes[i];
    const operator = info.operators.get(code) ?? code;
    const airline = airlineOf(d.airlines.get(code), code);
    const opRec = d.airlines.get(operator);
    const type =
      (types?.[i] && AIRCRAFT[types[i]]) ||
      typeFromFleet(d.fleets.get(operator) ?? (airline.icao ? d.fleets.get(airline.icao) : undefined), distNm(o, dst), rng);
    const operatedBy = opRec && opRec.icao && opRec.icao !== airline.icao ? opRec.name : null;
    if (i > 0) {
      const wait = connectionMinutes(legs[i - 1], { from: o, to: dst }, rng);
      layovers.push({ airport: toSimAirport(o), minutes: wait, fuelStop: false });
      t += wait * 60_000;
    }
    const leg = buildLeg(o, dst, airline, type, t, rng, false, { operator: opRec?.icao ?? operator, operatedBy });
    legs.push(leg);
    t = leg.arriveAt;
  }
  return finish('airline', legs, layovers);
}

/**
 * Airports for fuel stops along the great circle, adding stops until every leg is within
 * `rangeNm`. Null when the trip can't be done (e.g. a Cessna facing open ocean).
 */
function fuelStops(d: SimData, o: Airport, dst: Airport, rangeNm: number, minWeight: number): Airport[] | null {
  const total = distNm(o, dst);
  const pool = d.flyable.filter((a) => a.weight >= minWeight);
  // rangeNm already keeps a fuel reserve.
  let stops = Math.max(0, Math.ceil(total / rangeNm) - 1);
  for (; stops <= 12; stops++) {
    const points: Airport[] = [o];
    for (let i = 1; i <= stops; i++) {
      const target = intermediatePoint(o, dst, i / (stops + 1));
      points.push(pool.filter((a) => !points.includes(a) && a !== dst).reduce((best, a) => (distNm(a, target) < distNm(best, target) ? a : best)));
    }
    points.push(dst);
    const longest = Math.max(...points.slice(1).map((p, i) => distNm(points[i], p)));
    if (longest <= rangeNm) return points;
  }
  return hopToward(d, o, dst, rangeNm, minWeight);
}

/**
 * Fallback for trips the straight-line plan can't handle, e.g. airports on nearly opposite
 * sides of the Earth (no single great-circle path) or island-hopping: repeatedly fly to the
 * airport within range that gets closest to the destination.
 */
function hopToward(d: SimData, o: Airport, dst: Airport, rangeNm: number, minWeight: number): Airport[] | null {
  const pool = d.flyable.filter((a) => a.weight >= minWeight);
  const points = [o];
  let at = o;
  for (let hop = 0; hop < 60; hop++) {
    if (distNm(at, dst) <= rangeNm) return [...points, dst];
    let next: Airport | null = null;
    let nextLeft = distNm(at, dst);
    for (const a of pool) {
      if (a === at || points.includes(a) || distNm(at, a) > rangeNm) continue;
      const left = distNm(a, dst);
      if (left < nextLeft) {
        next = a;
        nextLeft = left;
      }
    }
    if (!next) return null;
    points.push(next);
    at = next;
  }
  return null;
}

/** One custom plane flown through the given airports (fuel stops in between). */
function customOption(spec: CustomPlaneSpec, points: Airport[], fuel: 'realistic' | 'unlimited', passengers: number | null, start: number, rng: Rng): ItineraryOption {
  const type = AIRCRAFT[spec.type];
  const operator: Airline = { name: spec.operator, iata: null, icao: null };
  const aircraftCount = passengers ? Math.ceil(passengers / spec.seats) : 1;
  const legs: ItineraryLeg[] = [];
  const layovers: Layover[] = [];
  let t = start;
  for (let i = 0; i < points.length - 1; i++) {
    if (i > 0) {
      // Refuelling takes at most 10 minutes, then it's back into the taxi queue.
      const wait = spec.key === 'C172' ? rng.int(5, 8) : rng.int(8, 10);
      layovers.push({ airport: toSimAirport(points[i]), minutes: wait, fuelStop: true });
      t += wait * 60_000;
    }
    const leg = buildLeg(points[i], points[i + 1], operator, type, t, rng, true, { operator: null, operatedBy: null }, fuel === 'unlimited');
    legs.push(leg);
    t = leg.arriveAt;
  }
  const total = distNm(points[0], points[points.length - 1]);
  const aerialRefuels = fuel !== 'realistic' ? 0 : spec.key === 'B2' ? b2RefuelCount(total) : spec.key === 'SR71' ? 1 + sr71MidRefuels(total) : 0;
  const note = aircraftCount > 1 ? `${aircraftCount} × ${spec.name} for ${(passengers ?? 0).toLocaleString()} people` : null;
  const opt = finish('custom', legs, layovers, { passengers, aircraftCount, note });
  return { ...opt, fuel, ...(aerialRefuels ? { aerialRefuels } : {}) };
}

/** The Custom Planes for a trip, each planned with realistic fuel (stops) and unlimited fuel (nonstop). */
export function customPlaneChoices(from: Place, to: Place, passengers: number | null, now: number, rng: Rng): CustomPlaneChoice[] {
  const d = simData();
  const out: CustomPlaneChoice[] = [];
  for (const spec of CUSTOM_PLANES) {
    // Any airport will do: no runway-length limits for the fun planes.
    const o = from.airports[0];
    const dst = to.airports[0];
    if (!o || !dst || o === dst) continue;
    let realistic: ItineraryOption | null = null;
    let unavailable: string | null = null;
    if (spec.key === 'B2' || spec.key === 'SR71' || spec.key === 'WALK') {
      // The B-2 and SR-71 refuel from tankers in mid-air; walkers don't need fuel at all.
      realistic = customOption(spec, [o, dst], 'realistic', passengers, now, rng);
    } else {
      const points = fuelStops(d, o, dst, spec.legRangeNm, 0);
      if (points) realistic = customOption(spec, points, 'realistic', passengers, now, rng);
      else unavailable = `Too much open water between airports for its fuel range (${Math.round(spec.legRangeNm * 1.150779).toLocaleString()} mi with reserves). Switch fuel to Unlimited.`;
    }
    out.push({
      key: spec.key,
      name: spec.name,
      summary: spec.summary,
      seats: spec.seats,
      realistic,
      unavailable,
      unlimited: spec.key === 'WALK' && realistic ? realistic : customOption(spec, [o, dst], 'unlimited', passengers, now, rng),
      fuelApplies: spec.key !== 'WALK',
    });
  }
  return out;
}

/** "Generalized cost" an average traveller minimizes: time and hassle. */
function travellerCost(opt: ItineraryOption, mixed: boolean): number {
  const longLayovers = opt.layovers.reduce((sum, l) => sum + Math.max(0, l.minutes - 150), 0);
  return 40 * (opt.durationMin / 60) + 110 * opt.stops + (longLayovers / 60) * 25 + (mixed ? 120 : 0);
}

export function findOptions(from: Place, to: Place, opts: { advanced: boolean; now: number; rng: Rng; passengers?: number | null }): ItineraryOption[] {
  const d = simData();
  const { rng, now } = opts;
  // A chosen passenger count, or null for a realistic load on each plane.
  const passengers = opts.passengers ? Math.max(1, Math.floor(opts.passengers)) : null;
  // Vague places ("Iowa"): simple mode samples a few airports at random (weighted by how busy
  // they are) so repeated searches vary; advanced mode compares the main ones.
  const sample = (airports: Airport[], n: number) => {
    const pool = airports.slice(0, 25);
    const out: Airport[] = [];
    while (out.length < Math.min(n, pool.length)) {
      const a = rng.weighted(pool, (x) => (out.includes(x) ? 0 : x.weight));
      if (out.includes(a)) break;
      out.push(a);
    }
    return out;
  };
  const pick = (p: Place, k: number) => (p.specific ? p.airports.slice(0, 3) : opts.advanced ? p.airports.slice(0, k) : sample(p.airports, 3));
  const origins = pick(from, 4);
  const dests = pick(to, 4);

  const scored: { opt: ItineraryOption; cost: number }[] = [];
  const seen = new Set<string>();
  for (const o of origins) {
    for (const dst of dests) {
      for (const path of findPaths(d, o, dst)) {
        for (const variant of airlineVariants(d, path)) {
          const key = path.map((a) => a.iata).join('-') + '/' + variant.codes.join(',');
          if (seen.has(key)) continue;
          seen.add(key);
          const opt = airlineOption(d, path, variant, now, rng);
          let departures = 1;
          if (passengers) {
            // Exactly that many fly: fill the plane, and send the rest on later departures.
            const perFlight = Math.min(...opt.legs.map((l) => seatCapacity(l.aircraftType, AIRCRAFT[l.aircraftType]?.kind ?? 'jet')));
            departures = Math.ceil(passengers / perFlight);
            opt.passengers = passengers;
            opt.paxThisDeparture = Math.min(passengers, perFlight);
            if (departures > 1) {
              const extra: ItineraryOption[] = [];
              let left = passengers - perFlight;
              for (let k = 1; k < departures; k++) {
                const dep = airlineOption(d, path, variant, now + k * GROUP_DEPARTURE_GAP_MS, rng, opt.legs.map((l) => l.aircraftType));
                dep.passengers = passengers;
                dep.paxThisDeparture = Math.min(left, perFlight);
                left -= dep.paxThisDeparture;
                extra.push(dep);
              }
              opt.extraDepartures = extra;
              opt.aircraftCount = departures;
              opt.note = `${passengers.toLocaleString()} passengers on ${departures} departures (up to ${perFlight.toLocaleString()} each), every ${GROUP_DEPARTURE_GAP_MS / 60_000} min`;
            }
          }
          scored.push({ opt, cost: travellerCost(opt, variant.mixed) + (departures - 1) * 60 });
        }
      }
    }
  }
  scored.sort((a, b) => a.cost - b.cost);
  const airline = scored.slice(0, 8).map((s) => s.opt);
  if (airline.length) {
    airline[0].tags.push('best');
    airline.reduce((m, o) => (o.durationMin < m.durationMin ? o : m)).tags.push('fastest');
  }

  return airline;
}

/** Random realistic trips: mostly real nonstop routes, some one-stop connections. */
export function randomOptions(count: number, now: number, rng: Rng): ItineraryOption[] {
  const d = simData();
  airportPicker ??= new WeightedPicker(d.flyable, (a) => a.weight);
  const out: ItineraryOption[] = [];
  for (let i = 0; i < count; i++) {
    const start = now + rng.int(0, 40) * 1000;
    let path: Path;
    if (rng.next() < 0.7) {
      const r = rng.pick(d.routeList);
      path = [r.from, r.info.to];
    } else {
      const o = airportPicker.pick(rng);
      const hubs = [...(d.routes.get(o)?.keys() ?? [])];
      if (!hubs.length) {
        i--;
        continue;
      }
      const h = rng.weighted(hubs, (a) => a.weight + 1);
      const onward = [...(d.routes.get(h)?.keys() ?? [])].filter(
        (x) => x !== o && distNm(o, h) + distNm(h, x) <= distNm(o, x) * 1.6 + 300,
      );
      path = onward.length ? [o, h, rng.pick(onward)] : [o, h];
    }
    const variants = airlineVariants(d, path);
    if (!variants.length) {
      i--;
      continue;
    }
    out.push(airlineOption(d, path, rng.pick(variants), start, rng));
  }
  return out;
}

// ── Flights from a length of time ────────────────────────────────────────────
// Find a real airline trip whose length (pushback → parked at the final gate) is as close
// as possible to a chosen time. Nonstops cover up to ~19 h; longer times chain connections.

interface RouteRef {
  from: Airport;
  to: Airport;
  nm: number;
}

/** Every nonstop route, shortest first. */
let routeRefs: RouteRef[] | null = null;
/** Rough trip length ≈ a + b × distance (fitted from real planned flights). */
let lengthFit: { a: number; b: number } | null = null;

function allRoutes(d: SimData): RouteRef[] {
  routeRefs ??= d.routeList.map((r) => ({ from: r.from, to: r.info.to, nm: distNm(r.from, r.info.to) })).sort((x, y) => x.nm - y.nm);
  return routeRefs;
}

function nonstop(d: SimData, from: Airport, to: Airport, start: number, rng: Rng): ItineraryOption | null {
  const variants = airlineVariants(d, [from, to]);
  return variants.length ? airlineOption(d, [from, to], rng.pick(variants), start, rng) : null;
}

const exactMin = (o: ItineraryOption) => (o.arriveAt - o.departAt) / 60_000;

function fitLength(d: SimData, rng: Rng): { a: number; b: number } {
  if (lengthFit) return lengthFit;
  const routes = allRoutes(d);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < 400; i++) {
    const r = rng.pick(routes);
    const o = nonstop(d, r.from, r.to, 0, rng);
    if (!o) continue;
    xs.push(r.nm);
    ys.push(exactMin(o));
  }
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
  const my = ys.reduce((s, y) => s + y, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const b = den ? num / den : 0.13;
  lengthFit = { a: my - b * mx, b };
  return lengthFit;
}

/** Index of the first route at least `nm` long. */
function lowerBound(routes: RouteRef[], nm: number): number {
  let lo = 0;
  let hi = routes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (routes[mid].nm < nm) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface Candidate {
  opt: ItineraryOption;
  err: number;
}

/** Nonstop routes around the right distance, planned for real; the closest ones win. */
function nonstopCandidates(d: SimData, targetMin: number, start: number, rng: Rng): Candidate[] {
  const routes = allRoutes(d);
  const fit = fitLength(d, rng);
  const out: Candidate[] = [];
  // Widen the distance window until there's a decent pool to choose from.
  for (let tol = Math.max(15, targetMin * 0.1); tol <= Math.max(240, targetMin); tol *= 2) {
    const lo = lowerBound(routes, (targetMin - tol - fit.a) / fit.b);
    const hi = lowerBound(routes, (targetMin + tol - fit.a) / fit.b);
    if (hi - lo < 40 && hi - lo < routes.length) continue;
    for (let i = 0; i < 220; i++) {
      const r = routes[lo + Math.floor(rng.next() * (hi - lo))];
      if (!r) break;
      const opt = nonstop(d, r.from, r.to, start, rng);
      if (opt) out.push({ opt, err: Math.abs(exactMin(opt) - targetMin) });
    }
    break;
  }
  return out;
}

/** Longer times: a random walk of connecting flights whose last leg fills the remaining time. */
function chainCandidates(d: SimData, targetMin: number, start: number, rng: Rng, attempts: number): Candidate[] {
  const fit = fitLength(d, rng);
  const est = (a: Airport, b: Airport) => fit.a + fit.b * distNm(a, b);
  const turn = 8; // average minutes at the gate between flights
  const longest = est(allRoutes(d).at(-1)!.from, allRoutes(d).at(-1)!.to);
  const minLegs = Math.max(2, Math.ceil((targetMin + turn) / (longest * 0.85)));
  airportPicker ??= new WeightedPicker(d.flyable, (a) => a.weight);
  const out: Candidate[] = [];
  for (let attempt = 0; attempt < attempts; attempt++) {
    const legs = minLegs + rng.int(0, 1);
    const path: Airport[] = [airportPicker.pick(rng)];
    let left = targetMin;
    let ok = true;
    for (let i = 0; i < legs - 1 && ok; i++) {
      const here = path[path.length - 1];
      const share = left / (legs - i);
      const next = [...(d.routes.get(here)?.keys() ?? [])].filter((x) => !path.includes(x) && Math.abs(est(here, x) - share) < share * 0.35);
      if (!next.length) ok = false;
      else {
        const x = rng.pick(next);
        left -= est(here, x) + turn;
        path.push(x);
      }
    }
    if (!ok || left < 15) continue;
    const here = path[path.length - 1];
    const last = [...(d.routes.get(here)?.keys() ?? [])]
      .filter((x) => !path.includes(x))
      .map((x) => ({ x, e: Math.abs(est(here, x) - left) }))
      .sort((a, b) => a.e - b.e)
      .slice(0, 5);
    if (!last.length) continue;
    path.push(rng.pick(last).x);
    const variants = airlineVariants(d, path);
    if (!variants.length) continue;
    const opt = airlineOption(d, path, rng.pick(variants), start, rng);
    out.push({ opt, err: Math.abs(exactMin(opt) - targetMin) });
  }
  return out;
}

/**
 * A random airline trip lasting as close to `targetMin` minutes as possible (pushback to
 * parked at the final gate). Among the closest matches, one is picked at random.
 */
export function timerOption(targetMin: number, start: number, rng: Rng): ItineraryOption | null {
  const d = simData();
  let pool = nonstopCandidates(d, targetMin, start, rng);
  const best = Math.min(Infinity, ...pool.map((c) => c.err));
  // Nonstops can't get close (very long times): try connecting flights too.
  if (best > Math.max(3, targetMin * 0.01)) pool = pool.concat(chainCandidates(d, targetMin, start, rng, 600));
  if (!pool.length) return null;
  const closest = Math.min(...pool.map((c) => c.err));
  const near = pool.filter((c) => c.err <= closest + 1);
  return rng.pick(near).opt;
}
