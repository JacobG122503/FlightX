/**
 * Cabin layouts per aircraft type (typical airline configurations). A layout
 * like "ABC-DEF" means seats A–C, an aisle, then D–F.
 */
import type { SeatMap, SeatCabin } from '../../../shared/sim';

type Code = SeatCabin['code'];
type Section = [code: Code, firstRow: number, lastRow: number, layout: string, deck?: 'Upper'];

const NB = (f: number, y: number, fLayout = 'AC-DF', yLayout = 'ABC-DEF'): Section[] => [
  ['F', 1, f, fLayout],
  ['Y', f + 1, f + y, yLayout],
];
const WB = (j: number, y: number, yLayout: string, w = 0, jLayout = 'A-DG-K'): Section[] => [
  ['J', 1, j, jLayout],
  ...(w ? ([['W', j + 1, j + w, 'AC-DEF-HK']] as Section[]) : []),
  ['Y', j + w + 1, j + w + y, yLayout],
];
const ALL_Y = (rows: number, layout: string): Section[] => [['Y', 1, rows, layout]];

const MAPS: Record<string, Section[]> = {
  A319: NB(2, 20),
  A320: NB(3, 24),
  A20N: NB(3, 25),
  A321: NB(5, 27),
  A21N: NB(5, 28),
  BCS3: NB(3, 24, 'AC-DF', 'AC-DEF'),
  B712: NB(3, 22, 'AC-DF', 'AC-DEF'),
  B732: NB(2, 18),
  B733: NB(2, 20),
  B734: NB(2, 23),
  B735: NB(2, 17),
  B736: NB(2, 18),
  B737: NB(3, 21),
  B738: NB(4, 26),
  B739: NB(5, 28),
  B38M: NB(4, 27),
  B39M: NB(5, 29),
  B752: NB(4, 30),
  B753: NB(6, 35),
  MD88: NB(4, 28, 'AC-DF', 'AC-DEF'),
  MD90: NB(4, 29, 'AC-DF', 'AC-DEF'),
  F100: NB(2, 19, 'AC-DF', 'AC-DEF'),
  SU95: NB(3, 17, 'AC-DF', 'ABC-DF'),
  E170: NB(2, 16, 'A-CD', 'AC-DF'),
  E75L: NB(3, 17, 'A-CD', 'AC-DF'),
  E190: NB(3, 22, 'AC-DF', 'AC-DF'),
  E195: NB(4, 24, 'AC-DF', 'AC-DF'),
  E145: ALL_Y(17, 'A-BC'),
  E135: ALL_Y(13, 'A-BC'),
  CRJ2: ALL_Y(13, 'AB-CD'),
  CRJ7: NB(2, 16, 'A-CD', 'AB-CD'),
  CRJ9: NB(3, 17, 'A-CD', 'AB-CD'),
  DH8D: ALL_Y(19, 'AB-CD'),
  DH8C: ALL_Y(13, 'AB-CD'),
  AT72: ALL_Y(18, 'AB-CD'),
  AT45: ALL_Y(12, 'AB-CD'),
  SF34: ALL_Y(12, 'A-BC'),
  B190: ALL_Y(10, 'A-B'),
  A306: WB(6, 32, 'AC-DEF-HK', 0, 'AC-DF-HK'),
  A310: WB(5, 28, 'AC-DEF-HK', 0, 'AC-DF-HK'),
  A332: WB(6, 30, 'AC-DEFG-HK'),
  A333: WB(7, 35, 'AC-DEFG-HK'),
  A339: WB(8, 34, 'AC-DEFG-HK'),
  A343: WB(8, 32, 'AC-DEFG-HK'),
  A346: WB(9, 38, 'AC-DEFG-HK'),
  A359: WB(10, 30, 'ABC-DEF-GHK', 3),
  B762: WB(5, 26, 'AC-DEF-HK', 0, 'AC-DF-HK'),
  B763: WB(6, 29, 'AC-DEF-HK'),
  B764: WB(8, 33, 'AC-DEF-HK'),
  B772: WB(8, 28, 'ABC-DEF-GHK'),
  B77L: WB(8, 28, 'ABC-DEF-GHK'),
  B77W: [['F', 1, 2, 'A-E-K'], ['J', 3, 12, 'A-DG-K'], ['W', 14, 17, 'ABC-DEF-GHK'], ['Y', 20, 50, 'ABC-DEFG-HJK']],
  B788: WB(7, 26, 'ABC-DEF-GHK'),
  B789: WB(8, 27, 'ABC-DEF-GHK', 3),
  B78X: WB(11, 31, 'ABC-DEF-GHK'),
  MD11: WB(8, 30, 'AC-DEFG-HK'),
  B744: [['F', 1, 3, 'A-DG-K'], ['J', 4, 11, 'AC-DEF-HK'], ['Y', 30, 58, 'ABC-DEFG-HJK'], ['J', 61, 68, 'AC-HK', 'Upper']],
  B748: [['F', 1, 2, 'A-DG-K'], ['J', 3, 11, 'AC-DEF-HK'], ['Y', 30, 60, 'ABC-DEFG-HJK'], ['J', 70, 78, 'AC-HK', 'Upper']],
  A388: [['Y', 23, 66, 'ABC-DEFG-HJK'], ['F', 1, 3, 'A-E-K', 'Upper'], ['J', 6, 22, 'A-DG-K', 'Upper'], ['W', 70, 75, 'AB-DEF-JK', 'Upper']],
  C172: [['Y', 1, 1, 'B'], ['Y', 2, 2, 'A-B']],
  SR22: [['Y', 1, 1, 'B'], ['Y', 2, 2, 'A-B']],
  BE20: [['Y', 1, 3, 'A-B'], ['Y', 4, 4, 'A']],
  PC12: ALL_Y(4, 'A-B'),
  E55P: ALL_Y(4, 'A-B'),
  CL35: ALL_Y(5, 'A-B'),
  GLF6: ALL_Y(7, 'A-B'),
};

const CABIN_NAME: Record<Code, string> = { F: 'First', J: 'Business', W: 'Premium Economy', Y: 'Economy' };

/** Generic layout when a type isn't listed: sized from its typical role. */
function generic(kind: string): Section[] {
  if (kind === 'heavy') return WB(8, 30, 'ABC-DEF-GHK');
  if (kind === 'light') return ALL_Y(17, 'AB-CD');
  return NB(3, 24);
}

const cache = new Map<string, SeatMap>();

export function seatMap(typeIcao: string, kind = 'jet', privateFlight = false): SeatMap {
  const key = `${typeIcao}|${kind}|${privateFlight}`;
  let m = cache.get(key);
  if (m) return m;
  const sections = MAPS[typeIcao] ?? generic(kind);
  const decks = new Map<string, SeatCabin[]>();
  let total = 0;
  for (const [code, first, last, layout, deck = 'Main'] of sections) {
    const rows = Array.from({ length: last - first + 1 }, (_, i) => first + i);
    const name = privateFlight ? 'Cabin' : CABIN_NAME[code];
    let list = decks.get(deck);
    if (!list) decks.set(deck, (list = []));
    list.push({ code, name, layout, rows });
    total += rows.length * layout.replace(/-/g, '').length;
  }
  m = {
    type: typeIcao,
    decks: [...decks].map(([name, cabins]) => ({ name, cabins })).sort((a) => (a.name === 'Main' ? -1 : 1)),
    capacity: total,
  };
  cache.set(key, m);
  return m;
}

/** All seat labels in order, with their cabin code. */
export function seatList(map: SeatMap): { seat: string; cabin: SeatCabin }[] {
  const out: { seat: string; cabin: SeatCabin }[] = [];
  for (const deck of map.decks)
    for (const cabin of deck.cabins)
      for (const row of cabin.rows) for (const letter of cabin.layout.replace(/-/g, '')) out.push({ seat: `${row}${letter}`, cabin });
  return out;
}
