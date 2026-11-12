/**
 * Aircraft performance and identity for simulated flights. Figures are typical
 * real-world values (cruise true airspeed, cruise levels, still-air range,
 * climb/descent rates) so flight times come out close to real schedules.
 */
import type { AircraftKind } from '../../../shared/types';
import type { Rng } from './random';

export interface AircraftType {
  icao: string;
  name: string;
  manufacturer: string;
  kind: AircraftKind;
  /** Cruise true airspeed, knots. */
  cruiseKt: number;
  /** Typical cruise altitude range, feet. */
  cruiseFt: [number, number];
  rangeNm: number;
  /** Climb rate below / above 10,000 ft, and descent rate (ft/min). */
  climb1: number;
  climb2: number;
  descent: number;
  regional: boolean;
  wiki: string;
}

const T = (
  icao: string,
  manufacturer: string,
  name: string,
  kind: AircraftKind,
  cruiseKt: number,
  cruiseFt: [number, number],
  rangeNm: number,
  wiki: string,
  opts: Partial<Pick<AircraftType, 'climb1' | 'climb2' | 'descent' | 'regional'>> = {},
): AircraftType => ({
  icao,
  manufacturer,
  name,
  kind,
  cruiseKt,
  cruiseFt,
  rangeNm,
  wiki,
  climb1: opts.climb1 ?? 2500,
  climb2: opts.climb2 ?? 1600,
  descent: opts.descent ?? 2200,
  regional: opts.regional ?? false,
});

const TP = { climb1: 1500, climb2: 1000, descent: 1500, regional: true };
const RJ = { regional: true };

export const AIRCRAFT: Record<string, AircraftType> = Object.fromEntries(
  [
    T('A319', 'Airbus', 'A319', 'jet', 447, [33000, 37000], 3700, 'Airbus_A320_family'),
    T('A320', 'Airbus', 'A320', 'jet', 450, [34000, 38000], 3300, 'Airbus_A320_family'),
    T('A321', 'Airbus', 'A321', 'jet', 450, [33000, 37000], 3200, 'Airbus_A321'),
    T('A20N', 'Airbus', 'A320neo', 'jet', 450, [34000, 38000], 3400, 'Airbus_A320neo_family'),
    T('A21N', 'Airbus', 'A321neo', 'jet', 450, [33000, 37000], 3700, 'Airbus_A321neo'),
    T('BCS3', 'Airbus', 'A220-300', 'jet', 447, [35000, 39000], 3400, 'Airbus_A220'),
    T('A306', 'Airbus', 'A300-600', 'heavy', 465, [31000, 37000], 4000, 'Airbus_A300'),
    T('A310', 'Airbus', 'A310', 'heavy', 465, [31000, 37000], 5000, 'Airbus_A310'),
    T('A332', 'Airbus', 'A330-200', 'heavy', 470, [35000, 39000], 7200, 'Airbus_A330'),
    T('A333', 'Airbus', 'A330-300', 'heavy', 470, [35000, 39000], 6300, 'Airbus_A330'),
    T('A339', 'Airbus', 'A330-900neo', 'heavy', 470, [35000, 39000], 7200, 'Airbus_A330neo'),
    T('A343', 'Airbus', 'A340-300', 'heavy', 475, [33000, 39000], 7300, 'Airbus_A340'),
    T('A346', 'Airbus', 'A340-600', 'heavy', 480, [33000, 39000], 7800, 'Airbus_A340'),
    T('A359', 'Airbus', 'A350-900', 'heavy', 488, [37000, 41000], 8100, 'Airbus_A350'),
    T('A388', 'Airbus', 'A380-800', 'heavy', 488, [35000, 41000], 8000, 'Airbus_A380'),
    T('B712', 'Boeing', '717-200', 'jet', 438, [33000, 37000], 1400, 'Boeing_717'),
    T('B732', 'Boeing', '737-200', 'jet', 420, [31000, 35000], 2000, 'Boeing_737_Original'),
    T('B733', 'Boeing', '737-300', 'jet', 430, [33000, 37000], 2200, 'Boeing_737_Classic'),
    T('B734', 'Boeing', '737-400', 'jet', 430, [33000, 37000], 2100, 'Boeing_737_Classic'),
    T('B735', 'Boeing', '737-500', 'jet', 430, [33000, 37000], 2400, 'Boeing_737_Classic'),
    T('B736', 'Boeing', '737-600', 'jet', 450, [35000, 39000], 3200, 'Boeing_737_Next_Generation'),
    T('B737', 'Boeing', '737-700', 'jet', 450, [35000, 39000], 3000, 'Boeing_737_Next_Generation'),
    T('B738', 'Boeing', '737-800', 'jet', 453, [34000, 38000], 2900, 'Boeing_737_Next_Generation'),
    T('B739', 'Boeing', '737-900', 'jet', 453, [34000, 38000], 2900, 'Boeing_737_Next_Generation'),
    T('B38M', 'Boeing', '737 MAX 8', 'jet', 453, [35000, 39000], 3500, 'Boeing_737_MAX'),
    T('B39M', 'Boeing', '737 MAX 9', 'jet', 453, [35000, 39000], 3500, 'Boeing_737_MAX'),
    T('B752', 'Boeing', '757-200', 'jet', 461, [35000, 39000], 3900, 'Boeing_757'),
    T('B753', 'Boeing', '757-300', 'jet', 461, [35000, 39000], 3400, 'Boeing_757'),
    T('B762', 'Boeing', '767-200', 'heavy', 470, [33000, 39000], 5200, 'Boeing_767'),
    T('B763', 'Boeing', '767-300ER', 'heavy', 470, [33000, 39000], 5900, 'Boeing_767'),
    T('B764', 'Boeing', '767-400ER', 'heavy', 470, [33000, 39000], 5600, 'Boeing_767'),
    T('B744', 'Boeing', '747-400', 'heavy', 490, [33000, 39000], 7200, 'Boeing_747-400'),
    T('B748', 'Boeing', '747-8', 'heavy', 490, [33000, 41000], 7700, 'Boeing_747-8'),
    T('B772', 'Boeing', '777-200ER', 'heavy', 490, [33000, 39000], 7000, 'Boeing_777'),
    T('B77L', 'Boeing', '777-200LR', 'heavy', 490, [33000, 41000], 8500, 'Boeing_777'),
    T('B77W', 'Boeing', '777-300ER', 'heavy', 490, [31000, 39000], 7300, 'Boeing_777'),
    T('B788', 'Boeing', '787-8 Dreamliner', 'heavy', 488, [37000, 41000], 7300, 'Boeing_787_Dreamliner'),
    T('B789', 'Boeing', '787-9 Dreamliner', 'heavy', 488, [37000, 41000], 7600, 'Boeing_787_Dreamliner'),
    T('B78X', 'Boeing', '787-10 Dreamliner', 'heavy', 488, [37000, 41000], 6300, 'Boeing_787_Dreamliner'),
    T('MD11', 'McDonnell Douglas', 'MD-11', 'heavy', 480, [31000, 37000], 6700, 'McDonnell_Douglas_MD-11'),
    T('MD88', 'McDonnell Douglas', 'MD-88', 'jet', 438, [31000, 35000], 2000, 'McDonnell_Douglas_MD-80'),
    T('MD90', 'McDonnell Douglas', 'MD-90', 'jet', 438, [31000, 35000], 2200, 'McDonnell_Douglas_MD-90'),
    T('F100', 'Fokker', '100', 'jet', 415, [29000, 35000], 1300, 'Fokker_100'),
    T('SU95', 'Sukhoi', 'Superjet 100', 'jet', 450, [33000, 39000], 2400, 'Sukhoi_Superjet_100'),
    T('E170', 'Embraer', 'E170', 'jet', 430, [33000, 37000], 2100, 'Embraer_E-Jet_family', RJ),
    T('E75L', 'Embraer', 'E175', 'jet', 430, [33000, 37000], 2000, 'Embraer_E-Jet_family', RJ),
    T('E190', 'Embraer', 'E190', 'jet', 447, [35000, 39000], 2400, 'Embraer_E-Jet_family', RJ),
    T('E195', 'Embraer', 'E195', 'jet', 447, [35000, 39000], 2300, 'Embraer_E-Jet_family', RJ),
    T('E145', 'Embraer', 'ERJ-145', 'jet', 410, [31000, 37000], 1500, 'Embraer_ERJ_family', RJ),
    T('E135', 'Embraer', 'ERJ-135', 'jet', 410, [31000, 37000], 1700, 'Embraer_ERJ_family', RJ),
    T('CRJ2', 'Bombardier', 'CRJ200', 'jet', 424, [31000, 37000], 1300, 'Bombardier_CRJ100/200', RJ),
    T('CRJ7', 'Bombardier', 'CRJ700', 'jet', 447, [33000, 37000], 1400, 'Bombardier_CRJ700_series', RJ),
    T('CRJ9', 'Bombardier', 'CRJ900', 'jet', 447, [33000, 37000], 1500, 'Bombardier_CRJ700_series', RJ),
    T('DH8D', 'De Havilland Canada', 'Dash 8-400', 'light', 300, [21000, 25000], 1100, 'De_Havilland_Canada_Dash_8', TP),
    T('DH8C', 'De Havilland Canada', 'Dash 8-300', 'light', 270, [19000, 25000], 900, 'De_Havilland_Canada_Dash_8', TP),
    T('AT72', 'ATR', '72-600', 'light', 275, [19000, 23000], 900, 'ATR_72', TP),
    T('AT45', 'ATR', '42-500', 'light', 260, [17000, 23000], 700, 'ATR_42', TP),
    T('SF34', 'Saab', '340', 'light', 250, [17000, 25000], 900, 'Saab_340', TP),
    T('B190', 'Beechcraft', '1900D', 'light', 270, [16000, 25000], 600, 'Beechcraft_1900', TP),
    T('E55P', 'Embraer', 'Phenom 300', 'jet', 450, [41000, 45000], 1900, 'Embraer_Phenom_300'),
    T('CL35', 'Bombardier', 'Challenger 350', 'jet', 465, [41000, 45000], 3200, 'Bombardier_Challenger_300'),
    T('GLF6', 'Gulfstream', 'G650ER', 'jet', 488, [41000, 47000], 7500, 'Gulfstream_G650'),
  ].map((t) => [t.icao, t]),
);

/** OpenFlights/planes.dat ICAO codes that differ from the ones above. */
const ALIASES: Record<string, string> = {
  E175: 'E75L', E75S: 'E75L', E170: 'E170', CRJ1: 'CRJ2', CRJX: 'CRJ9', A20N: 'A20N', A21N: 'A21N',
  B37M: 'B38M', B3XM: 'B39M', B77L: 'B77L', A35K: 'A359', A333: 'A333', B74S: 'B744', B742: 'B744',
  AT76: 'AT72', AT75: 'AT72', AT73: 'AT72', AT43: 'AT45', DH8A: 'DH8C', DH8B: 'DH8C', MD82: 'MD88',
  MD83: 'MD88', MD87: 'MD88', MD81: 'MD88', A318: 'A319', B722: 'B733', BCS1: 'BCS3', F70: 'F100',
  E290: 'E190', E295: 'E195', AJ27: 'CRJ9', C919: 'A320', A19N: 'A319', A338: 'A332', B753: 'B753', CRJ5: 'CRJ7',
  E35L: 'E135', E45X: 'E145', B77F: 'B77W', B744F: 'B744', DH8Q: 'DH8D', AT46: 'AT45', A310: 'A310',
};

export function aircraftType(icao: string | null | undefined): AircraftType | null {
  if (!icao) return null;
  const code = icao.toUpperCase();
  return AIRCRAFT[code] ?? AIRCRAFT[ALIASES[code] ?? ''] ?? null;
}

/** A sensible type when a route's equipment is unknown or can't make the distance. */
export function fallbackType(distanceNm: number, rng: Rng): AircraftType {
  if (distanceNm < 350) return AIRCRAFT[rng.pick(['DH8D', 'AT72', 'E75L', 'CRJ9'])];
  if (distanceNm < 900) return AIRCRAFT[rng.pick(['E75L', 'CRJ9', 'A320', 'B738', 'A319'])];
  if (distanceNm < 2600) return AIRCRAFT[rng.pick(['A320', 'B738', 'A321', 'B739', 'A20N', 'B38M'])];
  if (distanceNm < 3600) return AIRCRAFT[rng.pick(['B752', 'A21N', 'A321'])];
  if (distanceNm < 5600) return AIRCRAFT[rng.pick(['B763', 'A332', 'B788'])];
  if (distanceNm < 7000) return AIRCRAFT[rng.pick(['B789', 'A359', 'B77W', 'A332'])];
  return AIRCRAFT[rng.pick(['B77L', 'A359', 'B789'])];
}

/**
 * Picks an aircraft from the operator's real fleet that can fly the distance,
 * favouring types that suit it (no widebodies on short hops, no regional jets
 * on long ones). Falls back to a typical type for the distance.
 */
export function typeFromFleet(fleet: [string, number][] | undefined, distanceNm: number, rng: Rng): AircraftType {
  const usable = (fleet ?? [])
    .map(([code, count]) => ({ t: aircraftType(code), count }))
    .filter((x): x is { t: AircraftType; count: number } => x.t !== null && x.t.rangeNm >= distanceNm * 1.1);
  if (!usable.length) return fallbackType(distanceNm, rng);
  const suit = (t: AircraftType) =>
    (t.kind === 'heavy' && distanceNm < 1200 ? 0.12 : 1) * (t.regional && distanceNm > 1100 ? 0.3 : 1) * (t.kind === 'light' && distanceNm > 500 ? 0.2 : 1);
  return rng.weighted(usable, (x) => x.count * suit(x.t)).t;
}

/** Cruise altitude: within the type's range, odd thousands eastbound and even westbound. */
export function cruiseAltitude(t: AircraftType, trackDeg: number, distanceNm: number, rng: Rng): number {
  const [lo, hi] = t.cruiseFt;
  // Shorter flights don't bother climbing as high.
  const cap = distanceNm < 250 ? Math.min(hi, 24000) : distanceNm < 500 ? Math.min(hi, 32000) : hi;
  let ft = Math.round((lo + rng.next() * Math.max(0, cap - lo)) / 1000) * 1000;
  ft = Math.min(ft, cap);
  const eastbound = trackDeg >= 0 && trackDeg < 180;
  const thousands = ft / 1000;
  if (eastbound !== (thousands % 2 === 1)) ft -= 1000;
  return Math.max(ft, 9000);
}

// ── Registrations and transponder addresses by country ─────────────────────
interface Registry {
  prefix: string;
  pattern: 'us' | 'letters3' | 'letters4' | 'digits4' | 'ja' | 'digits5' | 'hl';
  hex: [number, number];
}

const REGISTRIES: Record<string, Registry> = {
  'United States': { prefix: 'N', pattern: 'us', hex: [0xa00001, 0xadf7c7] },
  Canada: { prefix: 'C-F', pattern: 'letters3', hex: [0xc00000, 0xc3ffff] },
  'United Kingdom': { prefix: 'G-', pattern: 'letters4', hex: [0x400000, 0x43ffff] },
  Germany: { prefix: 'D-A', pattern: 'letters3', hex: [0x3c0000, 0x3fffff] },
  France: { prefix: 'F-G', pattern: 'letters3', hex: [0x380000, 0x3bffff] },
  Ireland: { prefix: 'EI-', pattern: 'letters3', hex: [0x4ca000, 0x4cafff] },
  Netherlands: { prefix: 'PH-', pattern: 'letters3', hex: [0x480000, 0x487fff] },
  Spain: { prefix: 'EC-', pattern: 'letters3', hex: [0x340000, 0x37ffff] },
  Italy: { prefix: 'I-', pattern: 'letters4', hex: [0x300000, 0x33ffff] },
  Switzerland: { prefix: 'HB-J', pattern: 'letters3', hex: [0x4b0000, 0x4b7fff] },
  Mexico: { prefix: 'XA-', pattern: 'letters3', hex: [0x0d0000, 0x0d7fff] },
  Brazil: { prefix: 'PR-', pattern: 'letters3', hex: [0xe40000, 0xe7ffff] },
  China: { prefix: 'B-', pattern: 'digits4', hex: [0x780000, 0x7bffff] },
  Japan: { prefix: 'JA', pattern: 'ja', hex: [0x840000, 0x87ffff] },
  Australia: { prefix: 'VH-', pattern: 'letters3', hex: [0x7c0000, 0x7fffff] },
  India: { prefix: 'VT-', pattern: 'letters3', hex: [0x800000, 0x83ffff] },
  'United Arab Emirates': { prefix: 'A6-', pattern: 'letters3', hex: [0x896000, 0x896fff] },
  Qatar: { prefix: 'A7-', pattern: 'letters3', hex: [0x06a000, 0x06afff] },
  Turkey: { prefix: 'TC-', pattern: 'letters3', hex: [0x4b8000, 0x4bffff] },
  Russia: { prefix: 'RA-', pattern: 'digits5', hex: [0x100000, 0x1fffff] },
  'South Korea': { prefix: 'HL', pattern: 'hl', hex: [0x718000, 0x71ffff] },
};

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function registration(country: string | null, rng: Rng): { reg: string; hex: string } {
  const r = (country && REGISTRIES[country]) || null;
  const letters = (n: number) => Array.from({ length: n }, () => rng.pick([...LETTERS])).join('');
  const digits = (n: number) => Array.from({ length: n }, () => String(rng.int(0, 9))).join('');
  let reg: string;
  switch (r?.pattern) {
    case 'us':
      reg = `N${rng.int(1, 9)}${digits(rng.int(2, 3))}${letters(rng.int(1, 2))}`;
      break;
    case 'letters4':
      reg = `${r.prefix}${letters(4)}`;
      break;
    case 'digits4':
      reg = `${r.prefix}${digits(4)}`;
      break;
    case 'digits5':
      reg = `${r.prefix}${digits(5)}`;
      break;
    case 'ja':
      reg = `JA${digits(3)}${letters(1)}`;
      break;
    case 'hl':
      reg = `HL${digits(4)}`;
      break;
    case 'letters3':
      reg = `${r.prefix}${letters(3)}`;
      break;
    default:
      reg = `${(country ?? 'XX').slice(0, 2).toUpperCase()}-${letters(3)}`;
  }
  const [lo, hi] = r?.hex ?? [0x200000, 0x2fffff];
  return { reg, hex: rng.int(lo, hi).toString(16).padStart(6, '0') };
}

/** Random discrete transponder code (octal digits), avoiding special codes. */
export function squawk(rng: Rng): string {
  for (;;) {
    const code = Array.from({ length: 4 }, () => String(rng.int(0, 7))).join('');
    if (!['7500', '7600', '7700', '1200', '7000', '2000', '0000'].includes(code)) return code;
  }
}
