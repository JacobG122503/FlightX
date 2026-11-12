import type { AircraftKind } from './types';

/** ICAO type designators that should render as wide-body / heavy. */
const HEAVY_PREFIXES = [
  'A30', 'A310', 'A33', 'A34', 'A35', 'A38', 'A124', 'A225', 'B74', 'B76', 'B77', 'B78',
  'MD11', 'DC10', 'IL96', 'IL76', 'C5M', 'C17', 'KC46', 'BLCF', 'A400', 'AN22',
];

/** ADS-B emitter category ("A1"…"C3") → kind. */
export function kindFromAdsbCategory(category: string | null | undefined, typeCode?: string | null): AircraftKind {
  const t = typeCode?.toUpperCase();
  if (t && HEAVY_PREFIXES.some((p) => t.startsWith(p))) return 'heavy';
  switch (category?.toUpperCase()) {
    case 'A1':
    case 'B4':
      return 'light';
    case 'A2':
    case 'A3':
    case 'A4':
    case 'A6':
      return 'jet';
    case 'A5':
      return 'heavy';
    case 'A7':
      return 'heli';
    case 'B1':
      return 'glider';
    case 'C1':
    case 'C2':
    case 'C3':
      return 'ground';
    default:
      return 'unknown';
  }
}

/** OpenSky numeric category (extended=1) → ADS-B letter category. */
const OPENSKY_CATEGORY: Record<number, string> = {
  2: 'A1', 3: 'A2', 4: 'A3', 5: 'A4', 6: 'A5', 7: 'A6', 8: 'A7',
  9: 'B1', 10: 'B2', 11: 'B3', 12: 'B4', 14: 'B6', 15: 'B7', 16: 'C1', 17: 'C2', 18: 'C3',
};

export function kindFromOpenSkyCategory(category: number | null | undefined): AircraftKind {
  return kindFromAdsbCategory(category != null ? OPENSKY_CATEGORY[category] : null);
}

/**
 * Last-resort guess when the feed gives no category: airline-style callsigns
 * are jets, slow and low traffic is probably general aviation.
 */
export function guessKind(callsign: string | null, gsKt: number | null, altFt: number | null): AircraftKind {
  if (callsign && /^[A-Z]{3}\d/.test(callsign)) return 'jet';
  if (gsKt != null && gsKt < 160 && (altFt == null || altFt < 12000)) return 'light';
  return 'jet';
}

export function cleanCallsign(raw: string | null | undefined): string | null {
  const c = raw?.trim().toUpperCase();
  return c ? c : null;
}
