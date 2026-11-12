/**
 * Persistent simulation state, in the app's data folder:
 *  - simulation.json   trips (flight plans with absolute timestamps) — small, rewritten on save
 *  - flight-log.jsonl  every landed/crashed flight — append-only (see logfile.ts)
 * Together they're kept under MAX_SAVE_BYTES; the oldest log entries go first.
 *
 * Because every position is computed from the clock (see profile.ts), nothing
 * runs while FlightX is closed. On startup `advance()` simply notices which
 * flights have landed in the meantime and logs them with their real touchdown
 * times — so a plane sent on an 8-hour flight has 2 hours left 6 hours later.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import type { Airline } from '../../../shared/types';
import type { CustomPassenger, ItineraryOption, SimLogEntry } from '../../../shared/sim';
import { mapFor, passengerCount, placeCustom, type PaxInput } from './passengers';
import { simData, type Airport } from './data';
import { aircraftType, fallbackType, registration, squawk, type AircraftType } from './aircraft';
import { buildProfile, evaluate, type Profile } from './profile';
import { distNm } from './data';
import { Rng, newId } from './random';
import { FlightLogFile } from './logfile';

export interface StoredLeg {
  /** Flight id on the map = the aircraft's ICAO 24-bit address. */
  id: string;
  callsign: string;
  flightNumber: string;
  airline: Airline;
  from: string;
  to: string;
  type: string;
  reg: string;
  squawk: string;
  departAt: number;
  cruiseFt: number;
  taxiOutMin: number;
  taxiInMin: number;
  seed: number;
  /** Passengers you added (with seats on this aircraft). */
  custom?: CustomPassenger[];
  /** Charters: exact passenger count for this aircraft. */
  paxTarget?: number;
  /** Regional partner flying it (e.g. "SkyWest Airlines"). */
  operatedBy?: string;
}

export interface StoredTrip {
  id: string;
  createdAt: number;
  random: boolean;
  query: string | null;
  kind: 'airline' | 'charter';
  legs: StoredLeg[];
  /** Number of legs already finished (logged). */
  done: number;
}

interface StoreFile {
  version: 1 | 2;
  trips: StoredTrip[];
  /** Version 1 kept the log here; it now lives in flight-log.jsonl. */
  log?: SimLogEntry[];
  /** Last time FlightX was open (for "Things you missed"). */
  lastActiveAt?: number;
}

export interface LiveLeg {
  trip: StoredTrip;
  index: number;
  leg: StoredLeg;
  from: Airport;
  to: Airport;
  type: AircraftType;
  profile: Profile;
}

/** Upper limit for all saved simulation data (main file + flight log). */
export const MAX_SAVE_BYTES = 500 * 1024 * 1024;
/** Your actions (send, spawn, crash, clear) are saved within 2 s. */
const SAVE_SOON_MS = 2_000;
/**
 * Landings only need saving occasionally (and on quit): they can always be
 * recomputed from the stored flight plans, so a lost save loses nothing.
 */
const SAVE_LATER_MS = 60_000;

export class SimStore {
  private trips = new Map<string, StoredTrip>();
  private byFlightId = new Map<string, StoredTrip>();
  private live = new WeakMap<StoredLeg, LiveLeg>();
  private logFile: FlightLogFile;
  private mainBytes = 0;
  /** What landed between the last run and this launch (exact, however big the log is). */
  missedStats = { landed: 0, random: 0, passengers: 0, booked: [] as SimLogEntry[] };
  /** When FlightX was last open before this run (null on first run). */
  previousActiveAt: number | null = null;
  readonly loadedAt = Date.now();
  private lastActiveAt = Date.now();
  private dirty = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private saving = false;

  constructor(private readonly file: string) {
    this.logFile = new FlightLogFile(path.join(path.dirname(file), 'flight-log.jsonl'), () => MAX_SAVE_BYTES - this.mainBytes);
    this.load();
    const finalSave = () => {
      this.lastActiveAt = Date.now();
      this.dirty = true;
      this.flushSync();
    };
    process.on('exit', finalSave);
    // Stopping from VS Code / Ctrl-C sends a signal, which skips 'exit' handlers by default.
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.once(signal, () => {
        finalSave();
        process.exit(0);
      });
    }
  }

  // ── persistence ──────────────────────────────────────────────────────────
  private load() {
    if (!existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as StoreFile;
      // Skip trips whose airports aren't in the current dataset (e.g. after a data refresh).
      const known = simData().byIata;
      let skipped = 0;
      for (const t of data.trips ?? []) {
        if (t.legs.every((l) => known.has(l.from) && known.has(l.to))) this.index(t);
        else skipped++;
      }
      if (skipped) console.warn(`[sim] skipped ${skipped} saved trips that use airports no longer in the route data`);
      if (data.log?.length) {
        // Older saves kept the log inside simulation.json: move it to the log file.
        for (const e of data.log) this.logFile.add(e);
        this.dirty = true;
      }
      this.previousActiveAt = data.lastActiveAt ?? null;
      this.mainBytes = statSafe(this.file);
      console.log(`[sim] restored ${this.trips.size} trips and ${this.logFile.total} log entries from ${path.dirname(this.file)}`);
    } catch (err) {
      const backup = `${this.file}.corrupt-${Date.now()}`;
      console.warn(`[sim] could not read ${this.file} (${String(err)}); moved it to ${backup} and starting fresh`);
      try {
        renameSync(this.file, backup);
      } catch {
        /* ignore */
      }
    }
  }

  private serialize(): string {
    return JSON.stringify({ version: 2, trips: [...this.trips.values()], lastActiveAt: this.lastActiveAt } satisfies StoreFile);
  }

  private saveDue = 0;

  private markDirty(soon = true) {
    this.dirty = true;
    const due = Date.now() + (soon ? SAVE_SOON_MS : SAVE_LATER_MS);
    if (this.saveTimer && this.saveDue <= due) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveDue = due;
    this.saveTimer = setTimeout(() => void this.save(), due - Date.now());
  }

  private async save() {
    this.saveTimer = null;
    if (!this.dirty) return;
    if (this.saving) return this.markDirty();
    this.saving = true;
    this.dirty = false;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      const json = this.serialize();
      await writeFile(tmp, json);
      await rename(tmp, this.file);
      this.mainBytes = Buffer.byteLength(json);
      await this.logFile.flush();
    } catch (err) {
      console.warn(`[sim] save failed: ${String(err)}`);
      this.dirty = true;
    } finally {
      this.saving = false;
    }
  }

  /** Records that FlightX is open right now (saved lazily). */
  touch(now: number) {
    if (now - this.lastActiveAt < 30_000) return;
    this.lastActiveAt = now;
    this.markDirty(false);
  }

  /** Synchronous save on quit so nothing is lost. */
  flushSync() {
    if (!this.dirty) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const json = this.serialize();
      writeFileSync(this.file, json);
      this.mainBytes = Buffer.byteLength(json);
      this.logFile.flushSync();
      this.dirty = false;
    } catch {
      /* best effort */
    }
  }

  // ── trips ────────────────────────────────────────────────────────────────
  private index(trip: StoredTrip) {
    this.trips.set(trip.id, trip);
    for (const leg of trip.legs) this.byFlightId.set(leg.id, trip);
  }

  private unindex(trip: StoredTrip) {
    this.trips.delete(trip.id);
    for (const leg of trip.legs) if (this.byFlightId.get(leg.id) === trip) this.byFlightId.delete(leg.id);
  }

  liveLeg(trip: StoredTrip, index: number): LiveLeg {
    const leg = trip.legs[index];
    let l = this.live.get(leg);
    if (!l) {
      const d = simData();
      const from = d.byIata.get(leg.from)!;
      const to = d.byIata.get(leg.to)!;
      const type = aircraftType(leg.type) ?? fallbackType(distNm(from, to), new Rng(leg.seed));
      const profile = buildProfile({ from, to, type, cruiseFt: leg.cruiseFt, departAt: leg.departAt, taxiOutMin: leg.taxiOutMin, taxiInMin: leg.taxiInMin });
      l = { trip, index, leg, from, to, type, profile };
      this.live.set(leg, l);
    }
    return l;
  }

  paxInput(l: LiveLeg): PaxInput {
    return {
      seed: l.leg.seed,
      type: l.type.icao,
      kind: l.type.kind,
      privateFlight: l.trip.kind === 'charter',
      custom: l.leg.custom ?? [],
      from: l.from,
      to: l.to,
      target: l.leg.paxTarget,
    };
  }

  /**
   * Stores booked/random itineraries; `startAt` shifts the schedule so it departs then.
   * Charters for big groups become one trip per aircraft, with passengers split between them.
   */
  add(options: ItineraryOption[], meta: { random: boolean; query: string | null; startAt?: number; passengers?: CustomPassenger[] }): StoredTrip[] {
    const expanded: { opt: ItineraryOption; custom: CustomPassenger[]; target?: number }[] = [];
    for (const opt of options) {
      const custom = meta.passengers ?? [];
      if (opt.kind === 'charter') {
        const n = Math.max(opt.passengers, custom.length);
        const per = Math.ceil(n / opt.aircraftCount);
        for (let i = 0; i < opt.aircraftCount; i++) {
          expanded.push({ opt, custom: custom.slice(i * per, (i + 1) * per), target: Math.min(per, n - i * per) });
        }
      } else expanded.push({ opt, custom });
    }
    return this.addExpanded(expanded, meta);
  }

  private addExpanded(items: { opt: ItineraryOption; custom: CustomPassenger[]; target?: number }[], meta: { random: boolean; query: string | null; startAt?: number }): StoredTrip[] {
    const d = simData();
    const rng = new Rng();
    const created: StoredTrip[] = [];
    for (const { opt, custom, target } of items) {
      const shift = meta.startAt != null ? meta.startAt - opt.departAt : 0;
      const tripId = newId(rng);
      let privateId: { reg: string; hex: string } | null = null;
      const legs: StoredLeg[] = opt.legs.map((l) => {
        const country = opt.kind === 'charter' ? 'United States' : (d.airlines.get(l.operator ?? l.airline.iata ?? l.airline.icao ?? '')?.country ?? null);
        let ident: { reg: string; hex: string };
        if (opt.kind === 'charter') ident = privateId ??= registration('United States', rng);
        else {
          // Use a real airframe from the operator's fleet when one of that type is free.
          const real = (d.registry.get(l.operator ?? '') ?? []).filter(
            ([hex, , type]) => (aircraftType(type)?.icao ?? type) === l.aircraftType && !this.byFlightId.has(hex),
          );
          if (real.length) {
            const [hex, reg] = rng.pick(real);
            ident = { hex, reg };
          } else {
            ident = registration(country, rng);
            while (this.byFlightId.has(ident.hex)) ident = registration(country, rng);
          }
        }
        const callsign = opt.kind === 'charter' ? ident.reg.replace('-', '') : l.callsign;
        return {
          id: ident.hex,
          callsign,
          flightNumber: opt.kind === 'charter' ? ident.reg : l.flightNumber,
          airline: l.airline,
          from: l.from.iata,
          to: l.to.iata,
          type: l.aircraftType,
          reg: ident.reg,
          squawk: squawk(rng),
          departAt: l.departAt + shift,
          cruiseFt: l.cruiseFt,
          taxiOutMin: l.taxiOutMin,
          taxiInMin: l.taxiInMin,
          seed: rng.int(0, 2 ** 31),
          ...(custom.length
            ? { custom: placeCustom(custom, mapFor({ type: l.aircraftType, kind: aircraftType(l.aircraftType)?.kind ?? 'jet', privateFlight: opt.kind === 'charter' })) }
            : {}),
          ...(target != null ? { paxTarget: target } : {}),
          ...(l.operatedBy ? { operatedBy: l.operatedBy } : {}),
        };
      });
      const trip: StoredTrip = { id: tripId, createdAt: Date.now(), random: meta.random, query: meta.query, kind: opt.kind, legs, done: 0 };
      this.index(trip);
      created.push(trip);
    }
    if (created.length) this.markDirty();
    return created;
  }

  private logEntry(l: LiveLeg, outcome: SimLogEntry['outcome'], at: number): SimLogEntry {
    return {
      id: newId(),
      tripId: l.trip.id,
      random: l.trip.random,
      outcome,
      at,
      departedAt: l.profile.takeoffAt,
      callsign: l.leg.callsign,
      flightNumber: l.leg.flightNumber,
      airline: l.leg.airline.name,
      from: l.from.iata,
      fromCity: l.from.city?.split(',')[0] ?? null,
      to: l.to.iata,
      toCity: l.to.city?.split(',')[0] ?? null,
      aircraftType: l.type.icao,
      reg: l.leg.reg,
      legIndex: l.index,
      legCount: l.trip.legs.length,
      paxSeed: l.leg.seed,
      paxCount: passengerCount(this.paxInput(l)),
      ...(l.trip.kind === 'charter' ? { privateFlight: true } : {}),
      ...(l.leg.custom?.length ? { custom: l.leg.custom } : {}),
      ...(l.leg.paxTarget != null ? { paxTarget: l.leg.paxTarget } : {}),
    };
  }

  /** Newest log entries (in memory), oldest first. */
  get log(): SimLogEntry[] {
    return this.logFile.recent;
  }

  get logTotal(): number {
    return this.logFile.total;
  }

  /** Bytes used on disk by the save data. */
  get savedBytes(): number {
    return this.mainBytes + this.logFile.bytes;
  }

  private appendLog(entry: SimLogEntry) {
    this.logFile.add(entry);
    const since = this.previousActiveAt;
    if (entry.outcome === 'landed' && since != null && entry.at > since && entry.at <= this.loadedAt) {
      const m = this.missedStats;
      m.landed++;
      m.passengers += entry.paxCount ?? 0;
      if (entry.random) m.random++;
      else {
        m.booked.push(entry);
        if (m.booked.length > 60) m.booked.shift();
      }
    }
  }

  /** Logs every leg that has reached its gate by `now` (including while the app was closed). */
  advance(now: number) {
    let changed = false;
    for (const trip of this.trips.values()) {
      while (trip.done < trip.legs.length) {
        const l = this.liveLeg(trip, trip.done);
        if (l.profile.arriveAt > now) break;
        this.appendLog(this.logEntry(l, 'landed', l.profile.landAt));
        trip.done++;
        changed = true;
      }
      if (trip.done >= trip.legs.length) this.unindex(trip);
    }
    if (changed) {
      this.logFile.sortRecent();
      this.markDirty(false);
    }
  }

  /** Legs currently between pushback and gate arrival. */
  *active(now: number): Generator<LiveLeg> {
    for (const trip of this.trips.values()) {
      if (trip.done >= trip.legs.length) continue;
      const l = this.liveLeg(trip, trip.done);
      if (now >= l.profile.departAt && now < l.profile.arriveAt) yield l;
    }
  }

  /** The leg a flight id refers to (current or upcoming), if its trip is still running. */
  find(flightId: string): LiveLeg | null {
    const trip = this.byFlightId.get(flightId);
    if (!trip) return null;
    const index = trip.legs.findIndex((l, i) => l.id === flightId && i >= trip.done);
    return index >= 0 ? this.liveLeg(trip, index) : null;
  }

  allTrips(): StoredTrip[] {
    return [...this.trips.values()];
  }

  /** Crash a flying aircraft: it's logged as crashed and its trip ends. */
  crash(flightId: string, now: number): { live: LiveLeg; entry: SimLogEntry; lat: number; lon: number; altFt: number; trackDeg: number } | null {
    const l = this.find(flightId);
    if (!l) return null;
    const st = evaluate(l.profile, l.from, l.to, now, l.leg.seed);
    if (!st) return null;
    const entry = this.logEntry(l, 'crashed', now);
    this.appendLog(entry);
    this.unindex(l.trip);
    this.markDirty();
    return { live: l, entry, lat: st.lat, lon: st.lon, altFt: st.altFt, trackDeg: st.trackDeg };
  }

  /** Removes every active/scheduled trip (the flight log is kept). */
  clear(): number {
    const n = this.trips.size;
    this.trips.clear();
    this.byFlightId.clear();
    this.markDirty();
    return n;
  }

  get tripCount() {
    return this.trips.size;
  }
}

function statSafe(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}
