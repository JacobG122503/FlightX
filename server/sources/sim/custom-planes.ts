/**
 * Custom Planes: fun aircraft you can send anywhere in Advanced mode — a Cessna 172,
 * Concorde and a B-2 Spirit. Performance figures are real-world values; this module holds
 * their specs and identities, plus the land/sea grid Concorde uses to go supersonic only
 * over the ocean (sonic booms were banned over land).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CustomPlaneKey } from '../../../shared/sim';
import { intermediatePoint, type LatLon } from '../../../shared/geo';
import { dataDir, distNm } from './data';
import type { Rng } from './random';

export interface CustomPlaneSpec {
  key: CustomPlaneKey;
  /** ICAO type designator (aircraft.ts). */
  type: string;
  name: string;
  summary: string;
  /** People aboard one plane (B-2: its 2 crew seats). */
  seats: number;
  /** Planned distance between refuels, keeping a fuel reserve (NM). */
  legRangeNm: number;
  /** Operator shown on the flight. */
  operator: string;
  /** Everyone aboard is crew (the seats are always filled). */
  crewOnly?: true;
}

export const CUSTOM_PLANES: CustomPlaneSpec[] = [
  {
    key: 'C172',
    type: 'C172',
    name: 'Cessna 172 Skyhawk',
    summary: '4-seat piston single · 140 mph · 735 mi range',
    seats: 3, // plus the pilot
    legRangeNm: 520,
    operator: 'Private flight',
  },
  {
    key: 'CONC',
    type: 'CONC',
    name: 'Concorde',
    summary: 'Mach 2.04 over the ocean · 100 seats · 4,490 mi range',
    seats: 100,
    legRangeNm: 3500,
    operator: 'Concorde charter',
  },
  {
    key: 'B2',
    type: 'B2',
    name: 'B-2 Spirit',
    summary: 'Stealth bomber · Mach 0.85 · 2 crew seats · 6,900 mi unrefueled',
    seats: 2,
    crewOnly: true,
    legRangeNm: 5500,
    operator: 'U.S. Air Force',
  },
  {
    key: 'X59',
    type: 'X59',
    name: 'Lockheed Martin X-59 QueSST',
    summary: 'Quiet supersonic · Mach 1.42 over land · 1 pilot seat',
    seats: 1,
    crewOnly: true,
    // NASA hasn't published its range; ~1 hour of supersonic flight is a reasonable estimate.
    legRangeNm: 750,
    operator: 'NASA',
  },
  {
    key: 'SR71',
    type: 'SR71',
    name: 'Lockheed SR-71 Blackbird',
    summary: 'Mach 3.2 at 80,000 ft · 2 crew seats · tanker every ~2,900 mi',
    seats: 2,
    crewOnly: true,
    // Unrefueled ~2,900 NM; it met a tanker right after takeoff and then about every 2,500 NM.
    legRangeNm: 2500,
    operator: 'U.S. Air Force',
  },
  {
    key: 'ZEPP',
    type: 'ZEPP',
    name: 'Hindenburg (LZ 129)',
    summary: 'Airship · 76 mph at 650 ft · 72 passengers · 8,000 mi range',
    seats: 72,
    legRangeNm: 7000,
    operator: 'Deutsche Zeppelin-Reederei',
  },
  {
    key: 'WALK',
    type: 'WALK',
    name: 'Walk',
    summary: '3.1 mph on foot · swims at 2 mph over water',
    seats: 1,
    crewOnly: true,
    legRangeNm: Infinity,
    operator: 'Your own two feet',
  },
];

export const customPlane = (key: string) => CUSTOM_PLANES.find((p) => p.key === key || p.type === key) ?? null;

// ── Identities ───────────────────────────────────────────────────────────────

/** The real Concorde fleet's registrations (British Airways, Air France); addresses from the UK/French blocks. */
const CONCORDES: [reg: string, hex: number][] = [
  ['G-BOAA', 0x4006a0], ['G-BOAB', 0x4006a1], ['G-BOAC', 0x4006a2], ['G-BOAD', 0x4006a3], ['G-BOAE', 0x4006a4],
  ['G-BOAF', 0x4006a5], ['G-BOAG', 0x4006a6], ['F-BTSC', 0x3804a0], ['F-BTSD', 0x3804a1], ['F-BVFA', 0x3804a2],
  ['F-BVFB', 0x3804a3], ['F-BVFC', 0x3804a4], ['F-BVFF', 0x3804a5],
];
/** USAF serials of the B-2 fleet. */
const B2_SERIALS = [
  '82-1066', '82-1067', '82-1068', '82-1069', '82-1070', '82-1071', '88-0328', '88-0329', '88-0330', '88-0331', '88-0332',
  '89-0127', '89-0128', '89-0129', '90-0040', '90-0041', '92-0700', '93-1085', '93-1086', '93-1087', '93-1088',
];

/** Registration, 24-bit address and callsign for a custom plane (null: use a normal registration). */
/** USAF serials of the SR-71 fleet. */
const SR71_SERIALS = ['61-7955', '61-7958', '61-7959', '61-7960', '61-7962', '61-7967', '61-7968', '61-7971', '61-7972', '61-7973', '61-7974', '61-7975', '61-7976', '61-7979', '61-7980'];

const freeHex = (base: number, span: number, rng: Rng, taken: (hex: string) => boolean) => {
  let hex = '';
  do hex = (base + rng.int(0, span)).toString(16);
  while (taken(hex));
  return hex;
};

export function customIdent(type: string, rng: Rng, taken: (hex: string) => boolean): { reg: string; hex: string; callsign: string; flightNumber?: string } | null {
  if (type === 'SR71') {
    const callsign = `ASPEN${rng.int(10, 39)}`;
    return { reg: rng.pick(SR71_SERIALS), hex: freeHex(0xae4000, 0xfff, rng, taken), callsign, flightNumber: callsign };
  }
  if (type === 'ZEPP') {
    // Its real registration and radio call sign.
    return { reg: 'D-LZ129', hex: freeHex(0x3c4000, 0xfff, rng, taken), callsign: 'DEKKAR', flightNumber: 'LZ 129' };
  }
  if (type === 'WALK') {
    return { reg: 'On foot', hex: freeHex(0xf00000, 0xfffff, rng, taken), callsign: `WALKER${rng.int(1, 99)}`, flightNumber: 'On foot' };
  }
  if (type === 'CONC') {
    const free = CONCORDES.filter(([, hex]) => !taken(hex.toString(16)));
    const [reg, hex] = free.length ? rng.pick(free) : [rng.pick(CONCORDES)[0], 0x400000 + rng.int(0, 0x3ffff)];
    return { reg, hex: hex.toString(16), callsign: reg.replace('-', '') };
  }
  if (type === 'X59') {
    // There's only one: NASA 859.
    let hex = '';
    do hex = (0xabb000 + rng.int(0, 0xfff)).toString(16);
    while (taken(hex));
    return { reg: 'N859NA', hex, callsign: 'NASA859' };
  }
  if (type === 'B2') {
    let hex = '';
    do hex = (0xae0000 + rng.int(0, 0xffff)).toString(16);
    while (taken(hex));
    const callsign = `SPIRIT${rng.int(11, 49)}`;
    return { reg: rng.pick(B2_SERIALS), hex, callsign, flightNumber: callsign };
  }
  return null;
}

// ── Land / sea (for Concorde) ───────────────────────────────────────────────

let mask: { res: number; w: number; h: number; bits: Uint8Array } | null = null;

function landMask() {
  if (!mask) {
    const raw = JSON.parse(readFileSync(path.join(dataDir(), 'landmask.json'), 'utf8')) as { res: number; w: number; h: number; bits: string };
    mask = { res: raw.res, w: raw.w, h: raw.h, bits: new Uint8Array(Buffer.from(raw.bits, 'base64')) };
  }
  return mask;
}

function isLandCell(x: number, y: number): boolean {
  const m = landMask();
  if (y < 0 || y >= m.h) return true;
  const xx = ((x % m.w) + m.w) % m.w;
  const i = y * m.w + xx;
  return (m.bits[i >> 3] & (1 << (i & 7))) !== 0;
}

/** Over land, or within one grid cell (~15 NM) of it — too close for a sonic boom. */
function nearLand(p: LatLon): boolean {
  const m = landMask();
  const x = Math.floor((p.lon + 180) / m.res);
  const y = Math.floor((90 - p.lat) / m.res);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isLandCell(x + dx, y + dy)) return true;
  return false;
}

/** Concorde accelerated to Mach 2 over ~180 NM and slowed back down over ~150 NM. */
export const CONCORDE_ACCEL_NM = 180;
export const CONCORDE_DECEL_NM = 150;
/** Mach 2.02–2.04 in the stratosphere ≈ 1,160 kt true airspeed. */
export const CONCORDE_SUPERSONIC_KT = 1160;
/**
 * Short land crossings on a great circle (Ireland, Newfoundland, Nova Scotia…) are ignored:
 * real Concorde tracks skirted them just offshore and stayed supersonic.
 */
const SKIRTABLE_LAND_NM = 350;
const STEP_NM = 10;

const windowCache = new Map<string, [number, number][]>();

/**
 * Stretches of a great-circle route (distance along it, NM) where Concorde may fly at
 * Mach 2: open ocean long enough to accelerate, cruise and slow down again.
 */
export function supersonicWindows(from: LatLon, to: LatLon): [number, number][] {
  const key = `${from.lat},${from.lon}|${to.lat},${to.lon}`;
  const hit = windowCache.get(key);
  if (hit) return hit;
  const D = distNm(from, to);
  const n = Math.max(1, Math.ceil(D / STEP_NM));
  const sea: boolean[] = [];
  for (let i = 0; i <= n; i++) sea.push(!nearLand(intermediatePoint(from, to, i / n)));
  // Treat short land crossings between two stretches of ocean as ocean.
  for (let i = 0; i <= n; ) {
    if (sea[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j <= n && !sea[j]) j++;
    const before = i > 0 && sea[i - 1];
    const after = j <= n && sea[j];
    if (before && after && (j - i) * (D / n) < SKIRTABLE_LAND_NM) for (let k = i; k < j; k++) sea[k] = true;
    i = j;
  }
  const out: [number, number][] = [];
  const minLen = CONCORDE_ACCEL_NM + CONCORDE_DECEL_NM + 100;
  for (let i = 0; i <= n; ) {
    if (!sea[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j <= n && sea[j]) j++;
    const a = i * (D / n);
    const b = Math.min(D, (j - 1) * (D / n));
    if (b - a >= minLen) out.push([a, b]);
    i = j;
  }
  windowCache.set(key, out);
  return out;
}

// ── B-2 mid-air refuelling ──────────────────────────────────────────────────

/** Tanker meetup: descend to the refuelling level, take on fuel, climb back up. */
export const B2_REFUEL = { altFt: 26000, descentNm: 45, refuelMin: 22, refuelKt: 380, climbNm: 65 };

/** How many tanker meetups a B-2 needs for this distance (realistic fuel). */
export const b2RefuelCount = (distanceNm: number) => Math.max(0, Math.ceil(distanceNm / customPlane('B2')!.legRangeNm) - 1);

// ── SR-71 ─────────────────────────────────────────────────────────────────────

/** Mach 3.2 at 80,000 ft ≈ 1,830 kt true airspeed. */
export const SR71_KT = 1830;
export const SR71_FT = 80000;
/** Accelerate/climb from the refuelling level to Mach 3.2, and slow/descend back down (NM). */
export const SR71_ACCEL_NM = 250;
export const SR71_DECEL_NM = 200;
/** A tanker meetup: ~15 minutes at ~350 kt. */
export const SR71_REFUEL = { min: 15, kt: 350 };
/** Realistic fuel: one tanker right after takeoff, then about every 2,500 NM. */
export const sr71MidRefuels = (distanceNm: number) => Math.max(0, Math.ceil(distanceNm / customPlane('SR71')!.legRangeNm) - 1);

// ── Walking ──────────────────────────────────────────────────────────────────

/** Average walking speed 3.1 mph (5 km/h) and a casual swimmer's ~2 mph, in knots. */
export const WALK_KT = 3.1 / 1.150779;
export const SWIM_KT = 2.0 / 1.150779;

function isLandPoint(p: LatLon): boolean {
  const m = landMask();
  return isLandCell(Math.floor((p.lon + 180) / m.res), Math.floor((90 - p.lat) / m.res));
}

/** Stretches of a route over land and water (NM along it); tiny water gaps (rivers, coast pixels) count as land. */
export function landRuns(from: LatLon, to: LatLon): { s0: number; s1: number; land: boolean }[] {
  const D = distNm(from, to);
  const n = Math.max(1, Math.ceil(D / 5));
  const land: boolean[] = [];
  for (let i = 0; i <= n; i++) land.push(i === 0 || i === n || isLandPoint(intermediatePoint(from, to, i / n)));
  const runs: { s0: number; s1: number; land: boolean }[] = [];
  for (let i = 0; i <= n; ) {
    let j = i;
    while (j <= n && land[j] === land[i]) j++;
    const s0 = i * (D / n);
    const s1 = Math.min(D, j * (D / n));
    if (!land[i] && s1 - s0 < 10 && runs.length) runs[runs.length - 1].s1 = s1;
    else if (runs.length && runs[runs.length - 1].land === land[i]) runs[runs.length - 1].s1 = s1;
    else runs.push({ s0, s1, land: land[i] });
    i = j;
  }
  return runs;
}
