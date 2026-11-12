/**
 * Passengers for a simulated flight. Random passengers are generated from the
 * flight's seed (the same people every time you look), so nothing but your
 * custom passengers needs to be stored.
 */
import type { CustomPassenger, Passenger, SeatMap } from '../../../shared/sim';
import { simData, type Airport } from './data';
import { person } from './names';
import { seatList, seatMap } from './seatmaps';
import { Rng } from './random';

function seatSeed(seed: number, seat: string): number {
  let h = seed ^ 0x9e3779b9;
  for (const c of seat) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function loadFactor(seed: number, privateFlight: boolean): number {
  const r = new Rng(seed ^ 0x51ed27).next();
  return privateFlight ? 0.25 + r * 0.6 : 0.78 + r * 0.2;
}

export interface PaxInput {
  seed: number;
  type: string;
  kind: string;
  privateFlight: boolean;
  custom: CustomPassenger[];
  from: Airport;
  to: Airport;
  /** Charters: exactly this many passengers (custom + random). */
  target?: number;
}

const BUSINESS_JETS = new Set(['C172', 'SR22', 'BE20', 'PC12', 'E55P', 'CL35', 'GLF6']);

export function mapFor(input: Pick<PaxInput, 'type' | 'kind' | 'privateFlight'>): SeatMap {
  return seatMap(input.type, input.kind, input.privateFlight && BUSINESS_JETS.has(input.type));
}

/** Which seats are taken: custom ones, plus random ones (load factor, or an exact charter count). */
function occupied(input: PaxInput): Set<string> {
  const seats = seatList(mapFor(input)).map((s) => s.seat);
  const taken = new Set(input.custom.map((c) => c.seat));
  if (input.target != null) {
    const rng = new Rng(input.seed ^ 0x7f4a7c15);
    const free = seats.filter((s) => !taken.has(s));
    for (let i = free.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [free[i], free[j]] = [free[j], free[i]];
    }
    for (const s of free.slice(0, Math.max(0, input.target - taken.size))) taken.add(s);
    return taken;
  }
  const lf = loadFactor(input.seed, input.privateFlight);
  for (const s of seats) if (!taken.has(s) && new Rng(seatSeed(input.seed, s)).next() <= lf) taken.add(s);
  return taken;
}

/** Number of passengers on board (cheap: no names generated). */
export function passengerCount(input: PaxInput): number {
  return occupied(input).size;
}

export function passengerList(input: PaxInput): Passenger[] {
  const countries = simData().countries;
  const taken = occupied(input);
  const custom = new Map(input.custom.map((c) => [c.seat, c]));
  const out: Passenger[] = [];
  for (const { seat, cabin } of seatList(mapFor(input))) {
    if (!taken.has(seat)) continue;
    const c = custom.get(seat);
    if (c) {
      out.push({ seat, name: c.name, age: c.age, nationality: '', nationalityName: 'Your passenger', cabin: cabin.name, custom: true });
      continue;
    }
    const rng = new Rng(seatSeed(input.seed, seat));
    rng.next();
    const p = person(input.from.country, input.to.country, rng);
    out.push({ seat, ...p, nationalityName: countries.get(p.nationality)?.name ?? p.nationality, cabin: cabin.name, custom: false });
  }
  return out;
}

/** Puts custom passengers in valid, free seats on a given aircraft (auto-placing as needed). */
export function placeCustom(custom: CustomPassenger[], map: SeatMap): CustomPassenger[] {
  const seats = seatList(map).map((s) => s.seat);
  const valid = new Set(seats);
  const taken = new Set<string>();
  const placed: CustomPassenger[] = [];
  const pending: CustomPassenger[] = [];
  for (const c of custom.slice(0, seats.length)) {
    const p = { name: c.name.trim().slice(0, 60) || 'Passenger', age: Math.max(0, Math.min(120, Math.round(c.age) || 30)), seat: c.seat };
    if (valid.has(p.seat) && !taken.has(p.seat)) {
      taken.add(p.seat);
      placed.push(p);
    } else pending.push(p);
  }
  for (const p of pending) {
    const free = seats.find((s) => !taken.has(s));
    if (!free) break;
    taken.add(free);
    placed.push({ ...p, seat: free });
  }
  return placed;
}
