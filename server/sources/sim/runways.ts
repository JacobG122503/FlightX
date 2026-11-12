/**
 * Runway traffic: each airport has 1–4 runways (by how busy it is), and each runway
 * handles one takeoff or landing about every 2 minutes. A plane on its own taxis out
 * in a couple of minutes; when other simulated planes are leaving (or arriving) at the
 * same time, it waits for the next free slot — like a real departure queue.
 */
import type { Airport } from './data';
import type { Rng } from './random';

const MIN = 60_000;
/** Minimum spacing between movements on one runway. */
const RUNWAY_SPACING_MS = 2 * MIN;
/** Longest anyone waits (keeps huge spawns at one airport from queueing for days). */
const MAX_QUEUE_MS = 120 * MIN;

export function runways(a: Airport): number {
  return a.weight >= 300 ? 4 : a.weight >= 100 ? 3 : a.weight >= 30 ? 2 : 1;
}

/** Taxi time with no traffic: a couple of minutes, a bit longer at big airports. */
export function baseTaxiMin(a: Airport, rng: Rng): number {
  return runways(a) >= 3 ? rng.int(3, 6) : rng.int(2, 4);
}

/** Sorted takeoff and landing times per airport, used to find free runway slots. */
export class RunwayBook {
  private deps = new Map<string, number[]>();
  private arrs = new Map<string, number[]>();

  private static insert(list: number[], t: number) {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    list.splice(lo, 0, t);
  }

  private static slot(list: number[], wanted: number, spacing: number): number {
    // Earliest time >= wanted that is at least `spacing` from every booked movement.
    let t = wanted;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid] < t - spacing) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < list.length && list[i] < t + spacing; i++) {
      if (Math.abs(list[i] - t) < spacing) t = list[i] + spacing;
    }
    return Math.min(t, wanted + MAX_QUEUE_MS);
  }

  private listFor(map: Map<string, number[]>, code: string) {
    let list = map.get(code);
    if (!list) map.set(code, (list = []));
    return list;
  }

  /** Books a takeoff; returns the actual takeoff time. */
  bookTakeoff(a: Airport, wanted: number): number {
    const list = this.listFor(this.deps, a.iata);
    const t = RunwayBook.slot(list, wanted, RUNWAY_SPACING_MS / runways(a));
    RunwayBook.insert(list, t);
    return t;
  }

  /** Books a landing; returns the actual landing time. */
  bookLanding(a: Airport, wanted: number): number {
    const list = this.listFor(this.arrs, a.iata);
    const t = RunwayBook.slot(list, wanted, RUNWAY_SPACING_MS / runways(a));
    RunwayBook.insert(list, t);
    return t;
  }

  /** Other landings within ±10 minutes (busy ramps mean a slower taxi to the gate). */
  arrivalsNear(a: Airport, t: number): number {
    const list = this.arrs.get(a.iata) ?? [];
    let n = 0;
    for (const x of list) if (Math.abs(x - t) <= 10 * MIN) n++;
    return n;
  }

  /** Records an already-scheduled flight (on startup). */
  record(from: Airport, takeoffAt: number, to: Airport, landAt: number) {
    RunwayBook.insert(this.listFor(this.deps, from.iata), takeoffAt);
    RunwayBook.insert(this.listFor(this.arrs, to.iata), landAt);
  }

  /** Forgets movements more than an hour old. */
  prune(now: number) {
    for (const map of [this.deps, this.arrs]) {
      for (const [code, list] of map) {
        let i = 0;
        while (i < list.length && list[i] < now - 60 * MIN) i++;
        if (i) list.splice(0, i);
        if (!list.length) map.delete(code);
      }
    }
  }
}
