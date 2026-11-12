/**
 * Trip planning, like a flight-booking site: finds nonstop, one-stop and
 * two-stop itineraries on the real airline network (OpenFlights), keeps
 * airlines/alliances consistent, schedules realistic connections, prices each
 * option and picks a "Best match" — plus a private-charter option that makes
 * refuelling stops when the distance is beyond the jet's range.
 */
import { bearingDeg, intermediatePoint } from '../../../shared/geo';
import type { Airline } from '../../../shared/types';
import type { ItineraryLeg, ItineraryOption, Layover } from '../../../shared/sim';
import { simData, distNm, toSimAirport, type Airport, type AirlineRec, type SimData } from './data';
import { AIRCRAFT, cruiseAltitude, typeFromFleet, type AircraftType } from './aircraft';
import { seatMap } from './seatmaps';
import { buildProfile } from './profile';
import { baseTaxiMin } from './runways';
import { Rng, newId } from './random';
import type { Place } from './geocode';

const ALLIANCES: Record<string, string[]> = {
  'Star Alliance': ['A3', 'AC', 'AI', 'NZ', 'NH', 'OZ', 'OS', 'AV', 'SN', 'CM', 'OU', 'MS', 'ET', 'BR', 'LO', 'LH', 'SK', 'ZH', 'SQ', 'SA', 'LX', 'TP', 'TG', 'TK', 'UA', 'CA'],
  oneworld: ['AA', 'BA', 'CX', 'AY', 'IB', 'JL', 'MH', 'QF', 'QR', 'RJ', 'AT', 'UL', 'AS', 'US', 'LA', 'S7'],
  SkyTeam: ['SU', 'AR', 'AM', 'UX', 'AF', 'CI', 'MU', 'OK', 'DL', 'GA', 'KQ', 'KL', 'KE', 'ME', 'SV', 'RO', 'VN', 'MF', 'AZ', 'CZ'],
};
const LOW_COST = new Set(['G4', 'NK', 'F9', 'WN', 'B6', 'FR', 'U2', 'W6', 'VY', 'TO', 'HV', 'DY', 'SY', 'AK', '6E', 'TR', 'JQ', 'G3', 'VB', 'Y4', '5J', 'SG', 'FZ', 'XY', 'WS', 'D8', 'EW', 'LS', 'PC', 'MM', 'GK', 'QZ', '7C', 'ZE', 'LJ', 'BC', 'FD', 'VX']);
/** Point-to-point carriers that don't sell connecting itineraries. */
const POINT_TO_POINT = new Set(['G4', 'SY', 'XP', 'MX']);
const PREMIUM = new Set(['EK', 'QR', 'SQ', 'CX', 'EY', 'NH', 'JL', 'LX', 'BA', 'AF', 'LH', 'QF']);

type Path = Airport[];

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

function buildLeg(o: Airport, dst: Airport, airline: Airline, type: AircraftType, departAt: number, rng: Rng, privateFlight = false, op: Operation = { operator: null, operatedBy: null }): ItineraryLeg {
  const distance = distNm(o, dst);
  const cruise = cruiseAltitude(type, bearingDeg(o, dst), distance, rng);
  // Lone-plane taxi times; the store adds runway queueing when the flight is booked.
  const taxiOutMin = baseTaxiMin(o, rng);
  const taxiInMin = baseTaxiMin(dst, rng);
  const prof = buildProfile({ from: o, to: dst, type, cruiseFt: cruise, departAt, taxiOutMin, taxiInMin });
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
  };
}

/** Quick turns for the sim: a connection never takes more than 10 minutes at the gate. */
function connectionMinutes(prev: ItineraryLeg, next: { from: Airport; to: Airport }, rng: Rng): number {
  const international = prev.from.country !== prev.to.country || next.from.country !== next.to.country;
  return international ? rng.int(7, 10) : rng.int(5, 10);
}

function priceFor(legs: ItineraryLeg[], stops: number, rng: Rng): number {
  const first = legs[0].from;
  const last = legs[legs.length - 1].to;
  const miles = distNm(first, last) * 1.15078;
  const international = first.country !== last.country;
  let fare = international ? 160 + 0.085 * miles : 49 + 0.125 * miles;
  fare *= stops === 0 ? 1.12 : 1 - 0.06 * stops;
  const codes = legs.map((l) => l.airline.iata ?? '');
  if (codes.every((c) => LOW_COST.has(c))) fare *= 0.68;
  if (codes.some((c) => PREMIUM.has(c))) fare *= 1.1;
  fare *= 0.85 + rng.next() * 0.32;
  return Math.max(39, Math.round(fare));
}

function finish(
  kind: ItineraryOption['kind'],
  legs: ItineraryLeg[],
  layovers: Layover[],
  priceUsd: number,
  group: { passengers: number; aircraftCount?: number; note?: string | null } = { passengers: 1 },
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
    priceUsd,
    tags: [],
  };
}

function airlineOption(d: SimData, path: Path, variant: { codes: string[] }, start: number, rng: Rng, passengers = 1): ItineraryOption {
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
    const type = typeFromFleet(d.fleets.get(operator) ?? (airline.icao ? d.fleets.get(airline.icao) : undefined), distNm(o, dst), rng);
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
  return finish('airline', legs, layovers, priceFor(legs, legs.length - 1, rng) * passengers, { passengers });
}

/** Charter fleet: aircraft that can be chartered, small to huge. */
const CHARTER_FLEET = ['C172', 'SR22', 'BE20', 'PC12', 'E55P', 'CL35', 'GLF6', 'E75L', 'A20N', 'B38M', 'A21N', 'B752', 'B763', 'B788', 'B789', 'A359', 'B77W', 'B748', 'A388'];
/** Rough charter cost per block hour (USD) by type. */
const HOURLY: Record<string, number> = {
  C172: 250, SR22: 650, BE20: 2800, PC12: 2600,
  E55P: 4800, CL35: 7800, GLF6: 13500, E75L: 7500, A20N: 12500, B38M: 12500, A21N: 14000, B752: 15000,
  B763: 22000, B788: 24000, B789: 26000, A359: 28000, B77W: 31000, B748: 36000, A388: 42000,
};

/** Airports for fuel stops along the great circle, adding stops until every leg is within range. */
function fuelStops(d: SimData, o: Airport, dst: Airport, type: AircraftType): Airport[] {
  const total = distNm(o, dst);
  // Airliners need proper airports for a fuel stop; business jets can use small ones.
  const minWeight = type.kind === 'heavy' ? 30 : ['C172', 'SR22', 'BE20', 'PC12', 'E55P', 'CL35', 'GLF6'].includes(type.icao) ? 3 : 12;
  let stops = Math.max(0, Math.ceil(total / (type.rangeNm * 0.85)) - 1);
  for (; stops <= 8; stops++) {
    const points: Airport[] = [o];
    for (let i = 1; i <= stops; i++) {
      const target = intermediatePoint(o, dst, i / (stops + 1));
      points.push(
        d.flyable
          .filter((a) => a.weight >= minWeight && !points.includes(a) && a !== dst)
          .reduce((best, a) => (distNm(a, target) < distNm(best, target) ? a : best)),
      );
    }
    points.push(dst);
    const longest = Math.max(...points.slice(1).map((p, i) => distNm(points[i], p)));
    if (longest <= type.rangeNm * 0.95) return points;
  }
  return hopToward(d, o, dst, type, minWeight) ?? [o, dst];
}

/**
 * Fallback for trips the straight-line plan can't handle, e.g. airports on nearly opposite
 * sides of the Earth (no single great-circle path): repeatedly fly to the airport within
 * range that gets closest to the destination.
 */
function hopToward(d: SimData, o: Airport, dst: Airport, type: AircraftType, minWeight: number): Airport[] | null {
  const reach = type.rangeNm * 0.9;
  const pool = d.flyable.filter((a) => a.weight >= minWeight);
  const points = [o];
  let at = o;
  for (let hop = 0; hop < 40; hop++) {
    if (distNm(at, dst) <= reach) return [...points, dst];
    let next: Airport | null = null;
    let nextLeft = distNm(at, dst);
    for (const a of pool) {
      if (a === at || points.includes(a) || distNm(at, a) > reach) continue;
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

function charterOption(d: SimData, o: Airport, dst: Airport, type: AircraftType, passengers: number, start: number, rng: Rng, why: string): ItineraryOption {
  const capacity = seatMap(type.icao, type.kind, true).capacity;
  const aircraftCount = Math.ceil(passengers / capacity);
  const points = fuelStops(d, o, dst, type);
  const charter: Airline = { name: type.kind === 'heavy' || capacity > 20 ? 'Charter flight' : 'Private charter', iata: null, icao: null };
  const legs: ItineraryLeg[] = [];
  const layovers: Layover[] = [];
  let t = start;
  for (let i = 0; i < points.length - 1; i++) {
    if (i > 0) {
      // Refuelling is capped at 10 minutes too, then it's back into the taxi queue.
      const wait = type.kind === 'heavy' ? rng.int(8, 10) : rng.int(5, 8);
      layovers.push({ airport: toSimAirport(points[i]), minutes: wait, fuelStop: true });
      t += wait * 60_000;
    }
    const leg = buildLeg(points[i], points[i + 1], charter, type, t, rng, true);
    legs.push(leg);
    t = leg.arriveAt;
  }
  const hours = legs.reduce((h, l) => h + (l.arriveAt - l.departAt) / 3_600_000, 0);
  const price = Math.round((aircraftCount * (HOURLY[type.icao] ?? 15000) * hours + (points.length - 2) * 2500 * aircraftCount) / 100) * 100;
  const stops = points.length - 2;
  const planes = aircraftCount > 1 ? `${aircraftCount} × ${type.manufacturer} ${type.name}` : `${type.manufacturer} ${type.name}`;
  const note = `${why}: ${planes} (${capacity} seats${aircraftCount > 1 ? ' each' : ''}) for ${passengers.toLocaleString()} passenger${passengers === 1 ? '' : 's'} · ${
    stops === 0 ? 'nonstop' : `${stops} fuel stop${stops === 1 ? '' : 's'}`
  } (range ${type.rangeNm.toLocaleString()} NM)`;
  return finish('charter', legs, layovers, price, { passengers, aircraftCount, note });
}

/**
 * Charters sized for the group: the smallest aircraft whose cabin fits everyone
 * (stopping for fuel as its range requires), and a longer-range one if that
 * means fewer stops. Groups bigger than any aircraft are split across planes.
 */
function charterOptions(d: SimData, o: Airport, dst: Airport, passengers: number, start: number, rng: Rng): ItineraryOption[] {
  const total = distNm(o, dst);
  const fleet = CHARTER_FLEET.map((c) => AIRCRAFT[c]).map((type) => ({
    type,
    capacity: seatMap(type.icao, type.kind, true).capacity,
    stops: Math.max(0, Math.ceil(total / (type.rangeNm * 0.85)) - 1),
  }));
  const biggest = Math.max(...fleet.map((f) => f.capacity));
  const fits = fleet.filter((f) => f.capacity >= Math.min(passengers, biggest));
  // Smallest cabin that fits; among equal sizes, the faster aircraft.
  const smallest = fits.reduce((m, f) => (f.capacity < m.capacity || (f.capacity === m.capacity && f.type.cruiseKt > m.type.cruiseKt) ? f : m));
  const out = [charterOption(d, o, dst, smallest.type, passengers, start, rng, 'Sized for your group')];
  const fewerStops = fits.filter((f) => f.stops < smallest.stops).sort((a, b) => a.stops - b.stops || a.capacity - b.capacity)[0];
  if (fewerStops) out.push(charterOption(d, o, dst, fewerStops.type, passengers, start, rng, 'Fewer stops'));
  return out;
}

/** "Generalized cost" an average traveller minimizes: money, time and hassle. */
function travellerCost(opt: ItineraryOption, mixed: boolean): number {
  const longLayovers = opt.layovers.reduce((sum, l) => sum + Math.max(0, l.minutes - 150), 0);
  return opt.priceUsd / opt.passengers + 40 * (opt.durationMin / 60) + 110 * opt.stops + (longLayovers / 60) * 25 + (mixed ? 120 : 0);
}

export function findOptions(from: Place, to: Place, opts: { advanced: boolean; now: number; rng: Rng; passengers?: number }): ItineraryOption[] {
  const d = simData();
  const { rng, now } = opts;
  const passengers = Math.max(1, Math.floor(opts.passengers ?? 1));
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
          const opt = airlineOption(d, path, variant, now, rng, passengers);
          // A group can only book what's realistically available: ~30% of each flight's seats.
          const fits = opt.legs.every((l) => {
            const t = AIRCRAFT[l.aircraftType];
            return seatMap(l.aircraftType, t?.kind ?? 'jet').capacity * 0.3 >= passengers;
          });
          if (fits) scored.push({ opt, cost: travellerCost(opt, variant.mixed) });
        }
      }
    }
  }
  scored.sort((a, b) => a.cost - b.cost);
  const airline = scored.slice(0, 8).map((s) => s.opt);
  if (airline.length) {
    airline[0].tags.push('best');
    airline.reduce((m, o) => (o.priceUsd < m.priceUsd ? o : m)).tags.push('cheapest');
    airline.reduce((m, o) => (o.durationMin < m.durationMin ? o : m)).tags.push('fastest');
  }

  const o = origins[0];
  const dst = dests.find((x) => x !== o);
  const result = [...airline];
  if (o && dst) {
    const charters = charterOptions(d, o, dst, passengers, now, rng);
    if (opts.advanced) {
      // You said how many people are flying: the plane sized for your group is the best match,
      // and airline tickets (seats on a shared flight) are the alternatives.
      for (const a of airline) {
        a.tags = a.tags.filter((t) => t !== 'best');
        a.note = `Airline tickets: ${passengers} seat${passengers === 1 ? '' : 's'} on a scheduled flight shared with other travellers`;
      }
      charters[0].tags.push('best');
      return [charters[0], ...charters.slice(1), ...airline];
    }
    if (!airline.length) charters[0].tags.push('best');
    result.push(...charters);
  }
  return result;
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
