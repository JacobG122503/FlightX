/**
 * Remembers recent positions of every aircraft we've seen, so we can draw a
 * trail even when OpenSky has no track for it (e.g. aircraft only adsb.lol sees).
 */
import type { FlightState, TrackPoint } from '../../../shared/types';

const MAX_POINTS = 400;
const MIN_INTERVAL_MS = 8_000;
const FORGET_AFTER_MS = 45 * 60_000;

export class PositionHistory {
  private tracks = new Map<string, { points: TrackPoint[]; lastSeen: number }>();
  private lastPrune = Date.now();

  record(states: Iterable<FlightState>): void {
    const now = Date.now();
    for (const s of states) {
      let entry = this.tracks.get(s.id);
      if (!entry) {
        entry = { points: [], lastSeen: now };
        this.tracks.set(s.id, entry);
      }
      entry.lastSeen = now;
      const last = entry.points[entry.points.length - 1];
      if (last && s.ts - last.t < MIN_INTERVAL_MS) continue;
      entry.points.push({ t: s.ts, lat: s.lat, lon: s.lon, altFt: s.altFt, onGround: s.onGround });
      if (entry.points.length > MAX_POINTS) entry.points.splice(0, entry.points.length - MAX_POINTS);
    }
    if (now - this.lastPrune > 5 * 60_000) this.prune(now);
  }

  get(id: string): TrackPoint[] {
    return this.tracks.get(id)?.points ?? [];
  }

  private prune(now: number) {
    this.lastPrune = now;
    for (const [id, entry] of this.tracks) if (now - entry.lastSeen > FORGET_AFTER_MS) this.tracks.delete(id);
  }
}
