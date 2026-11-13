/**
 * How many passengers a simulated flight carries: an exact number when you chose one
 * (or a crew-only plane's crew), otherwise a realistic load for the aircraft, derived from
 * the flight's seed so it's the same every time you look.
 */
import { seatCapacity } from './seatmaps';
import { Rng } from './random';

export interface PaxInput {
  seed: number;
  type: string;
  kind: string;
  /** Small private planes fly emptier than airliners. */
  privateFlight: boolean;
  /** Exactly this many aboard (you chose a passenger count, or a crew-only plane). */
  target?: number;
}

function loadFactor(seed: number, privateFlight: boolean): number {
  const r = new Rng(seed ^ 0x51ed27).next();
  return privateFlight ? 0.25 + r * 0.6 : 0.78 + r * 0.2;
}

export const capacityOf = (input: Pick<PaxInput, 'type' | 'kind'>) => seatCapacity(input.type, input.kind);

/** Number of passengers on board. */
export function passengerCount(input: PaxInput): number {
  const cap = capacityOf(input);
  if (input.target != null) return Math.min(cap, input.target);
  return Math.max(1, Math.min(cap, Math.round(cap * loadFactor(input.seed, input.privateFlight))));
}
