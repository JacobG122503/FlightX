/**
 * Understands trip requests like "Iowa to Florida", "Iowa City to Miami",
 * "DSM to MCO", "Portland, Maine to UK" or "O'Hare to Heathrow".
 *
 * Each side resolves to a place (airport, city, state/region or country) and
 * then to the realistic airline airports that serve it, weighted by how busy
 * they are — so "Iowa" means Des Moines or Cedar Rapids, not a grass strip.
 */
import { simData, distNm, type Airport, type SimData } from './data';

export interface Place {
  kind: 'airport' | 'city' | 'region' | 'country';
  label: string;
  /** Candidate airline airports, best first. */
  airports: Airport[];
  /** True for an airport or city; false for a whole state/country (pick one at random). */
  specific: boolean;
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const COUNTRY_ALIASES: Record<string, string> = {
  uk: 'GB', 'u k': 'GB', britain: 'GB', 'great britain': 'GB', 'united kingdom': 'GB',
  usa: 'US', us: 'US', 'u s': 'US', 'u s a': 'US', america: 'US', 'united states of america': 'US', states: 'US',
  holland: 'NL', korea: 'KR', 'south korea': 'KR', russia: 'RU', uae: 'AE', emirates: 'AE',
  czechia: 'CZ', 'czech republic': 'CZ', vietnam: 'VN', 'viet nam': 'VN', iran: 'IR', turkiye: 'TR',
};

/** Region names that also exist elsewhere and usually mean the US state when typed alone. */
const COUNTRY_REGION_ALIASES: Record<string, string> = {
  england: 'GB-ENG', scotland: 'GB-SCT', wales: 'GB-WLS', 'northern ireland': 'GB-NIR',
};

interface Indexes {
  cities: Map<string, { city: string; region: string; country: string; lat: number; lon: number }[]>;
  regions: Map<string, string[]>;
  usStateCodes: Map<string, string>;
  countries: Map<string, string>;
  regionWeight: Map<string, number>;
  countryWeight: Map<string, number>;
}

let idx: Indexes | null = null;

function indexes(d: SimData): Indexes {
  if (idx) return idx;
  const cities = new Map<string, Indexes['cities'] extends Map<string, infer V> ? V : never>();
  for (const p of d.places) {
    const names = new Set([norm(p.city), ...p.city.split(/[,/]/).map(norm)]);
    for (const n of names) {
      if (n.length < 2) continue;
      let list = cities.get(n);
      if (!list) cities.set(n, (list = []));
      list.push(p);
    }
  }
  const regions = new Map<string, string[]>();
  const usStateCodes = new Map<string, string>();
  for (const [code, r] of d.regions) {
    const n = norm(r.name);
    let list = regions.get(n);
    if (!list) regions.set(n, (list = []));
    list.push(code);
    if (r.country === 'US' || r.country === 'CA' || r.country === 'AU') usStateCodes.set(r.localCode.toLowerCase(), code);
  }
  const countries = new Map<string, string>();
  for (const [code, c] of d.countries) {
    countries.set(norm(c.name), code);
    for (const k of c.keywords) if (k.length > 2) countries.set(norm(k), code);
  }
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) countries.set(alias, code);
  const regionWeight = new Map<string, number>();
  const countryWeight = new Map<string, number>();
  for (const a of d.flyable) {
    regionWeight.set(a.region, (regionWeight.get(a.region) ?? 0) + a.weight);
    countryWeight.set(a.country, (countryWeight.get(a.country) ?? 0) + a.weight);
  }
  idx = { cities, regions, usStateCodes, countries, regionWeight, countryWeight };
  return idx;
}

/** Splits "X to Y" (also "from X to Y", "X → Y", "X - Y"). */
export function parseTripQuery(q: string): { from: string; to: string } | null {
  const cleaned = q.trim().replace(/^from\s+/i, '');
  const m = /^(.+?)\s+(?:to|→|->|-|–|—)\s+(.+)$/i.exec(cleaned) ?? /^(.+?)\s*(?:→|->)\s*(.+)$/.exec(cleaned);
  if (!m) return null;
  return { from: m[1].trim(), to: m[2].trim() };
}

function regionLabel(d: SimData, code: string): string {
  const r = d.regions.get(code);
  const c = r ? d.countries.get(r.country) : null;
  return r ? `${r.name}${c && r.country !== 'US' ? `, ${c.name}` : ' (US state)'}` : code;
}

function airportsNear(d: SimData, lat: number, lon: number, radiusNm: number): Airport[] {
  return d.flyable
    .map((a) => ({ a, dist: distNm(a, { lat, lon }) }))
    .filter((x) => x.dist <= radiusNm)
    .sort((x, y) => y.a.weight / (1 + x.dist / 40) - x.a.weight / (1 + y.dist / 40))
    .map((x) => x.a);
}

function cityScore(d: SimData, c: { lat: number; lon: number }): number {
  return airportsNear(d, c.lat, c.lon, 35).reduce((sum, a) => sum + a.weight, 0);
}

function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function resolvePlace(text: string): Place | null {
  const d = simData();
  const ix = indexes(d);
  const raw = text.trim().replace(/^the\s+/i, '');
  if (!raw) return null;

  // Airport codes.
  const upper = raw.toUpperCase();
  const byCode = /^[A-Z]{3}$/.test(upper) ? d.byIata.get(upper) : /^[A-Z]{4}$/.test(upper) ? d.byIcao.get(upper) : undefined;
  if (byCode) return airportPlace(d, byCode);

  // "City State" without a comma ("Wilton Iowa", "Lafayette IN", "Panama City Florida").
  if (!raw.includes(',') && !ix.cities.has(norm(raw))) {
    const words = raw.split(/\s+/);
    for (let k = Math.min(3, words.length - 1); k >= 1; k--) {
      const head = words.slice(0, -k).join(' ');
      const tail = norm(words.slice(-k).join(' '));
      const isQualifier = ix.usStateCodes.has(tail) || ix.regions.has(tail) || ix.countries.has(tail) || Boolean(COUNTRY_REGION_ALIASES[tail]);
      if (isQualifier && ix.cities.has(norm(head))) {
        const place = resolvePlace(`${head}, ${words.slice(-k).join(' ')}`);
        if (place) return place;
      }
    }
  }

  // "City, Qualifier" (state, state code or country).
  const [namePart, qualPart] = raw.split(/,(.+)/).map((s) => s?.trim());
  const name = norm(namePart);
  let qualRegion: string | null = null;
  let qualCountry: string | null = null;
  if (qualPart) {
    const q = norm(qualPart);
    qualRegion = ix.usStateCodes.get(q) ?? ix.regions.get(q)?.[0] ?? COUNTRY_REGION_ALIASES[q] ?? null;
    qualCountry = qualRegion ? null : (ix.countries.get(q) ?? null);
  }

  // Candidates of each kind.
  const cityMatches = (ix.cities.get(name) ?? []).filter(
    (c) => (!qualRegion || c.region === qualRegion) && (!qualCountry || c.country === qualCountry),
  );
  const bestCity = cityMatches.length
    ? cityMatches.map((c) => ({ c, score: cityScore(d, c) })).sort((a, b) => b.score - a.score)[0]
    : null;

  const regionCodes = qualPart ? [] : [...(ix.regions.get(name) ?? []), ...(COUNTRY_REGION_ALIASES[name] ? [COUNTRY_REGION_ALIASES[name]] : [])];
  const bestRegion = regionCodes.map((code) => ({ code, score: ix.regionWeight.get(code) ?? 0 })).sort((a, b) => b.score - a.score)[0] ?? null;
  const countryCode = qualPart ? null : (ix.countries.get(name) ?? null);
  const countryScore = countryCode ? (ix.countryWeight.get(countryCode) ?? 0) : 0;

  // A city wins if it's a real air-travel hub compared with a same-named state/country.
  const areaScore = Math.max(bestRegion?.score ?? 0, countryScore);
  if (bestCity && (bestCity.score >= 0.25 * areaScore || areaScore === 0)) {
    const near = airportsNear(d, bestCity.c.lat, bestCity.c.lon, 40);
    const airports = near.length ? near.slice(0, 4) : airportsNear(d, bestCity.c.lat, bestCity.c.lon, 160).slice(0, 3);
    if (airports.length) {
      const region = d.regions.get(bestCity.c.region);
      // Label with the part of the place name that matched ("Tokyo", not "Kita, Tokyo").
      const matched = bestCity.c.city.split(/[,/]/).map((x) => x.trim()).find((x) => norm(x) === name) ?? bestCity.c.city.split(',')[0];
      return { kind: 'city', label: `${matched}${region && norm(region.name) !== norm(matched) ? `, ${region.name}` : ''}`, airports, specific: true };
    }
  }
  if (bestRegion && bestRegion.score >= countryScore && bestRegion.score > 0) return regionPlace(d, bestRegion.code);
  if (countryCode && countryScore > 0) return countryPlace(d, countryCode);

  // Airport names ("Heathrow", "O'Hare", "LaGuardia").
  if (name.length >= 4) {
    const hit = d.flyable.find((a) => norm(a.name).includes(name));
    if (hit) return airportPlace(d, hit);
  }

  // Typos: closest state/country/major city name.
  if (name.length >= 4) {
    let best: { dist: number; place: () => Place | null } | null = null;
    const consider = (candidate: string, place: () => Place | null) => {
      const dist = levenshtein(name, candidate);
      if (dist <= (name.length >= 7 ? 2 : 1) && (!best || dist < best.dist)) best = { dist, place };
    };
    for (const [n, codes] of ix.regions) if ((ix.regionWeight.get(codes[0]) ?? 0) > 0) consider(n, () => regionPlace(d, codes[0]));
    for (const [n, code] of ix.countries) if ((ix.countryWeight.get(code) ?? 0) > 0) consider(n, () => countryPlace(d, code));
    for (const a of d.flyable.slice(0, 600)) if (a.city) consider(norm(a.city.split(',')[0]), () => resolvePlace(a.city!.split(',')[0]));
    const found = best as { dist: number; place: () => Place | null } | null;
    if (found) return found.place();
  }
  return null;
}

function airportPlace(d: SimData, a: Airport): Place {
  const airports = a.weight > 0 ? [a] : airportsNear(d, a.lat, a.lon, 160).slice(0, 3);
  return { kind: 'airport', label: `${a.name} (${a.iata})`, airports, specific: true };
}

function regionPlace(d: SimData, code: string): Place {
  const airports = d.flyable.filter((a) => a.region === code).sort((a, b) => b.weight - a.weight);
  return { kind: 'region', label: regionLabel(d, code), airports, specific: false };
}

function countryPlace(d: SimData, code: string): Place {
  const airports = d.flyable.filter((a) => a.country === code).sort((a, b) => b.weight - a.weight);
  return { kind: 'country', label: d.countries.get(code)?.name ?? code, airports, specific: false };
}
