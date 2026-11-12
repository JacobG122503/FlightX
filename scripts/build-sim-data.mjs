/**
 * Builds the simulator's reference data from free public datasets:
 *
 *  - Virtual Radar Server standing data (CC0, community-maintained, updated daily)
 *      https://github.com/vradarserver/standing-data
 *      routes (callsign → airports), airlines, aircraft (real fleets + registrations)
 *  - OurAirports (public domain)  https://ourairports.com/data/
 *      airports.csv, regions.csv, countries.csv
 *  - OpenFlights airports.dat (ODbL) — only for airport time zones
 *
 * Usage:
 *   node scripts/build-sim-data.mjs <folder with OurAirports CSVs + airports.dat> <standing-data checkout>
 * Output: server/sources/sim/dataset/*.json (committed; re-run to refresh routes).
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const [rawDir, vrsDir] = process.argv.slice(2);
if (!rawDir || !vrsDir) {
  console.error('usage: node scripts/build-sim-data.mjs <ourairports folder> <vrs standing-data folder>');
  process.exit(1);
}
const outDir = path.resolve('server/sources/sim/dataset');
mkdirSync(outDir, { recursive: true });

/** Minimal CSV parser: quoted fields, "" escapes, commas inside quotes, BOM. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const read = (file) => parseCsv(readFileSync(file, 'utf8'));
/** CSV with a header row → objects. */
const readObjects = (file) => {
  const [header, ...rows] = read(file);
  return rows.filter((r) => r.length >= header.length - 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
};
const filesUnder = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : p.endsWith('.csv') ? [p] : [];
  });
const nul = (v) => (v == null || v === '\\N' || v === '' ? null : v);
const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const nm = (a, b) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lon - a.lon) / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.sqrt(h));
};

// ── Time zones (OpenFlights) ───────────────────────────────────────────────
const tzByIata = new Map();
for (const r of read(path.join(rawDir, 'airports.dat'))) {
  const iata = nul(r[4]);
  const tz = nul(r[11]);
  if (iata && tz) tzByIata.set(iata, tz);
}

// ── Airports (OurAirports) ─────────────────────────────────────────────────
const TYPE_WEIGHT = { large_airport: 3, medium_airport: 2, small_airport: 1 };
const airportRows = readObjects(path.join(rawDir, 'airports.csv'));
const byIcao = new Map(); // ICAO → airport info (only airports usable by airlines)
const places = new Map(); // geocoding: "city|region" → place
for (const a of airportRows) {
  const w = TYPE_WEIGHT[a.type];
  if (!w) continue;
  const lat = Number(a.latitude_deg);
  const lon = Number(a.longitude_deg);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  if (a.municipality) {
    const key = `${a.municipality.toLowerCase()}|${a.iso_region}`;
    const prev = places.get(key);
    if (!prev || w > prev[5]) places.set(key, [a.municipality, a.iso_region, a.iso_country, round(lat, 3), round(lon, 3), w]);
  }
  const usable = a.iata_code?.length === 3 && (a.scheduled_service === 'yes' || a.type === 'large_airport');
  if (!usable) continue;
  const info = { iata: a.iata_code, icao: a.icao_code || a.gps_code || a.ident, name: a.name, city: a.municipality || null, region: a.iso_region, country: a.iso_country, lat, lon, elev: Number(a.elevation_ft) || 0 };
  for (const code of new Set([a.icao_code, a.gps_code, a.ident].filter(Boolean))) if (!byIcao.has(code)) byIcao.set(code, info);
}

// ── Airlines (VRS) ─────────────────────────────────────────────────────────
const airlineRows = readObjects(path.join(vrsDir, 'airlines/schema-01/airlines.csv'));
const airlineByIcao = new Map();
for (const a of airlineRows) {
  if (!a.ICAO) continue;
  let positioning = null;
  let charter = null;
  try {
    if (a.PositioningFlightPattern) positioning = new RegExp(a.PositioningFlightPattern);
    if (a.CharterFlightPattern) charter = new RegExp(a.CharterFlightPattern);
  } catch {
    /* ignore bad patterns */
  }
  airlineByIcao.set(a.ICAO, { icao: a.ICAO, iata: a.IATA || null, name: a.Name, positioning, charter });
}

/** Freight, fractional/business-jet and other non-passenger operators. */
const NOT_PASSENGER = new Set([
  'FDX', 'UPS', 'GTI', 'ABX', 'ATN', 'CKS', 'CLX', 'BCS', 'DHK', 'DHL', 'BOX', 'AJT', 'CAO', 'CKK', 'GEC', 'MPH', 'NCA', 'PAC', 'SQC',
  'ABW', 'SWN', 'TAY', 'MXL', 'QTR_CARGO', 'KYE', 'WGN', 'SRR', 'NPT', 'CTJ', 'AAH_CARGO', 'ESD', 'RCH', 'CNV', 'PAT', 'EJA', 'LXJ',
  'XOJ', 'VJT', 'NJE', 'GAJ', 'TWY', 'EJM', 'JRE', 'FWK', 'JTL', 'PJS', 'CXK', 'KFS', 'FDY', 'MTN', 'SNC', 'AMF', 'BDA', 'WAV',
]);

/** Regional operators flying under a mainline brand (operator ICAO → marketing IATA codes). */
const REGIONAL = {
  SKW: ['UA', 'DL', 'AA', 'AS'], ENY: ['AA'], RPA: ['AA', 'UA', 'DL'], EDV: ['DL'], ASH: ['UA', 'AA'], PDT: ['AA'], JIA: ['AA'],
  GJS: ['UA'], QXE: ['AS'], AWI: ['AA', 'UA'], CPZ: ['DL', 'AA'], UCA: ['UA'], CHQ: ['AA', 'UA'], ASQ: ['UA'], JZA: ['AC'],
  SKV: ['AC'], WEN: ['WS'], CLH: ['LH'], KLC: ['KL'], CFE: ['BA'], HOP: ['AF'], BCY: ['BA', 'EI'], QLK: ['QF'], NWK: ['QF'],
  AKX: ['NH'], JLJ: ['JL'], AUI: ['PS'], SAS_CONNECT: ['SK'], SZS: ['SK'], ANE: ['IB'], DLA: ['AZ'], CYL: ['AZ'], NOZ: ['DY'],
};
const HUBS = {
  UA: ['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX'],
  DL: ['ATL', 'MSP', 'DTW', 'SLC', 'JFK', 'LAX', 'SEA', 'LGA', 'BOS'],
  AA: ['DFW', 'CLT', 'ORD', 'PHL', 'MIA', 'PHX', 'DCA', 'LAX', 'JFK', 'LGA'],
  AS: ['SEA', 'PDX', 'SFO', 'LAX', 'ANC'],
};

/** Airlines that merged into another: route their old callsigns to today's operator. */
const MERGED = { COA: 'UAL', AWE: 'AAL', USA: 'AAL', VRD: 'ASA', TRS: 'SWA', NWA: 'DAL', CAW: 'AAL', MEP: 'AAL' };
/** Codes other operators' flights get mis-filed under: keep only routes touching the airline's country. */
const MUST_TOUCH = { BHS: 'BS' };
const EU = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'NO', 'IS', 'CH', 'GB']);

// ── Routes (VRS) ───────────────────────────────────────────────────────────
// Pass 1: candidate legs, and each operator's home country (where most of its flights touch).
const legs = [];
const touches = new Map(); // operator → Map(country → count)
let rows = 0;
for (const file of filesUnder(path.join(vrsDir, 'routes/schema-01'))) {
  for (const r of readObjects(file)) {
    rows++;
    const op = MERGED[r.AirlineCode] ?? r.AirlineCode;
    if (!op || NOT_PASSENGER.has(op)) continue;
    const airline = airlineByIcao.get(op);
    if (!airline) continue;
    if (airline.positioning?.test(r.Number) || airline.charter?.test(r.Number)) continue;
    const stops = (r.AirportCodes || '').split('-').map((c) => byIcao.get(c));
    if (stops.length < 2 || stops.some((s) => !s)) continue;
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      if (a.iata === b.iata) continue;
      const d = nm(a, b);
      if (d < 30 || d > 9800) continue;
      if (MUST_TOUCH[op] && a.country !== MUST_TOUCH[op] && b.country !== MUST_TOUCH[op]) continue;
      legs.push({ op, airline, a, b });
      let m = touches.get(op);
      if (!m) touches.set(op, (m = new Map()));
      for (const c of new Set([a.country, b.country])) m.set(c, (m.get(c) ?? 0) + 1);
    }
  }
}
const home = new Map([...touches].map(([op, m]) => [op, [...m].sort((x, y) => y[1] - x[1])[0][0]]));

// Pass 2: keep legal legs (no domestic flights by foreign airlines, except within the EU).
const pairs = new Map(); // "SRC>DST" → Map(marketing code → operator ICAO)
let kept = 0;
{
  for (const { op, airline, a, b } of legs) {
    {
      const h = home.get(op);
      if (a.country === b.country && a.country !== h && !(EU.has(a.country) && EU.has(h))) continue;
      const partners = REGIONAL[op];
      const marketing = partners
        ? (partners.length === 1 ? partners[0] : (partners.find((p) => HUBS[p]?.includes(a.iata) || HUBS[p]?.includes(b.iata)) ?? partners[0]))
        : (airline.iata ?? op);
      const key = `${a.iata}>${b.iata}`;
      let p = pairs.get(key);
      if (!p) pairs.set(key, (p = new Map()));
      if (!p.has(marketing)) p.set(marketing, op);
      kept++;
    }
  }
}
console.log(`routes: ${rows.toLocaleString()} callsigns read, ${kept.toLocaleString()} passenger legs kept, ${pairs.size.toLocaleString()} airport pairs`);

// Busy-ness of each airport: departing (airline, destination) pairs.
const departures = new Map();
const airlineCountries = new Map(); // operator ICAO → Map(country → departures)
for (const [key, ops] of pairs) {
  const src = key.split('>')[0];
  departures.set(src, (departures.get(src) ?? 0) + ops.size);
  for (const op of ops.values()) {
    const country = [...byIcao.values()].find((x) => x.iata === src)?.country;
    let m = airlineCountries.get(op);
    if (!m) airlineCountries.set(op, (m = new Map()));
    if (country) m.set(country, (m.get(country) ?? 0) + 1);
  }
}

// ── Output airports (only those with passenger routes) ─────────────────────
const seen = new Set();
const airports = [];
for (const a of byIcao.values()) {
  if (seen.has(a.iata) || !departures.has(a.iata)) continue;
  seen.add(a.iata);
  airports.push([a.iata, a.icao, a.name, a.city, a.region, a.country, round(a.lat), round(a.lon), a.elev, tzByIata.get(a.iata) ?? null, departures.get(a.iata)]);
}
airports.sort((x, y) => y[10] - x[10]);
const indexOf = new Map(airports.map((a, i) => [a[0], i]));

const routes = [];
const usedCodes = new Set();
for (const [key, ops] of pairs) {
  const [src, dst] = key.split('>');
  const si = indexOf.get(src);
  const di = indexOf.get(dst);
  if (si == null || di == null) continue;
  routes.push([si, di, [...ops].map(([mkt, op]) => `${mkt}:${op}`).join('|')]);
  for (const [mkt, op] of ops) {
    usedCodes.add(mkt);
    usedCodes.add(op);
  }
}

// Airlines: marketing codes (IATA or ICAO) and operator ICAOs → [name, icao, iata, country].
const byIata = new Map([...airlineByIcao.values()].filter((a) => a.iata).map((a) => [a.iata, a]));
const mainCountry = (op) => [...(airlineCountries.get(op) ?? new Map())].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
const countryNames = new Map(read(path.join(rawDir, 'countries.csv')).slice(1).map((r) => [r[1], r[2]]));
const airlines = {};
for (const code of usedCodes) {
  const a = code.length === 3 ? airlineByIcao.get(code) : byIata.get(code);
  if (!a) continue;
  const cc = mainCountry(a.icao);
  airlines[code] = [a.name, a.icao, a.iata, cc ? (countryNames.get(cc) ?? cc) : null];
}

// ── Fleets and real registrations (VRS aircraft) ───────────────────────────
const fleets = {}; // operator ICAO → { type: count }
const registry = {}; // operator ICAO → [[hex, reg, type], …] (capped)
for (const file of filesUnder(path.join(vrsDir, 'aircraft/schema-01'))) {
  for (const a of readObjects(file)) {
    const op = a.AirlineCode;
    if (!op || !usedCodes.has(op) || !a.ModelICAO) continue;
    (fleets[op] ??= {})[a.ModelICAO] = (fleets[op][a.ModelICAO] ?? 0) + 1;
    const list = (registry[op] ??= []);
    if (list.length < 80 && a.ICAO && a.Registration) list.push([a.ICAO.toLowerCase(), a.Registration, a.ModelICAO]);
  }
}

// ── Regions, countries ─────────────────────────────────────────────────────
const regions = {};
for (const r of read(path.join(rawDir, 'regions.csv')).slice(1)) {
  const [, code, localCode, name, , country, , keywords] = r;
  if (code) regions[code] = [name, country, localCode, keywords || ''];
}
const countries = {};
for (const r of read(path.join(rawDir, 'countries.csv')).slice(1)) {
  const [, code, name, , , keywords] = r;
  if (code) countries[code] = [name, keywords || ''];
}

const write = (name, data) => {
  writeFileSync(path.join(outDir, name), JSON.stringify(data));
  console.log(`${name.padEnd(16)} ${(JSON.stringify(data).length / 1024).toFixed(0).padStart(6)} KB`);
};
write('airports.json', airports);
write('routes.json', routes);
write('airlines.json', airlines);
write('fleets.json', fleets);
write('registry.json', registry);
write('places.json', [...places.values()]);
write('regions.json', regions);
write('countries.json', countries);
console.log(`${airports.length} airports, ${routes.length} route pairs, ${Object.keys(airlines).length} airlines, ${Object.keys(fleets).length} fleets`);
