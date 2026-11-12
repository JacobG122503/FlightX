/**
 * Static-ish information about an aircraft or flight, fetched when a plane is
 * selected and cached aggressively.
 *
 *  - adsbdb (https://www.adsbdb.com): aircraft registry + callsign → route.
 *  - airport-data.com: fallback aircraft photos.
 *
 *  - Planespotters.net: only when PLANESPOTTERS_CONTACT is set (their API requires a
 *    contact in server User-Agents). Otherwise the browser fetches them (src/lib/photos.ts).
 */
import { config } from '../../config';
import { fetchJson, HttpError, errorMessage } from '../../lib/http';
import { TtlCache } from '../../lib/cache';
import type { AircraftInfo, AircraftPhoto, Airport, FlightRoute } from '../../../shared/types';

const HOUR = 3_600_000;

interface AdsbdbAirport {
  name: string;
  municipality?: string;
  country_name?: string;
  iata_code?: string;
  icao_code?: string;
  latitude: number;
  longitude: number;
}

interface AdsbdbAircraft {
  type?: string;
  icao_type?: string;
  manufacturer?: string;
  registration?: string;
  registered_owner?: string;
  registered_owner_operator_flag_code?: string;
  registered_owner_country_name?: string;
  url_photo?: string | null;
  url_photo_thumbnail?: string | null;
}

interface AdsbdbRoute {
  callsign: string;
  airline?: { name: string; icao?: string; iata?: string } | null;
  origin: AdsbdbAirport;
  destination: AdsbdbAirport;
}

const toAirport = (a: AdsbdbAirport): Airport => ({
  icao: a.icao_code || null,
  iata: a.iata_code || null,
  name: a.name,
  city: a.municipality || null,
  country: a.country_name || null,
  lat: a.latitude,
  lon: a.longitude,
});

/** adsbdb answers unknown lookups with 404 and `{"response":"unknown ..."}`. */
async function adsbdb<T>(path: string): Promise<T | null> {
  try {
    const { data } = await fetchJson<{ response: T | string }>(`https://api.adsbdb.com/v0${path}`, { timeoutMs: 10_000 });
    return typeof data.response === 'string' ? null : data.response;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

interface AircraftLookup {
  info: AircraftInfo;
  photo: AircraftPhoto | null;
}

const aircraftCache = new TtlCache<AircraftLookup | null>(5000);
const routeCache = new TtlCache<Omit<FlightRoute, 'plausible'> | null>(5000);
const photoCache = new TtlCache<AircraftPhoto | null>(5000);
const planespottersCache = new TtlCache<AircraftPhoto | null>(5000);

export function getAircraft(id: string): Promise<AircraftLookup | null> {
  return aircraftCache.getOrLoad(
    id,
    (v) => (v ? 24 * HOUR : 6 * HOUR),
    async () => {
      const res = await adsbdb<{ aircraft: AdsbdbAircraft }>(`/aircraft/${encodeURIComponent(id)}`);
      const a = res?.aircraft;
      if (!a) return null;
      return {
        info: {
          reg: a.registration || null,
          typeCode: a.icao_type || null,
          typeName: a.type || null,
          manufacturer: a.manufacturer || null,
          owner: a.registered_owner || null,
          operatorCode: a.registered_owner_operator_flag_code || null,
          country: a.registered_owner_country_name || null,
        },
        photo: a.url_photo_thumbnail
          ? { thumbnail: a.url_photo_thumbnail, large: a.url_photo || null, link: null, photographer: null, source: 'airport-data.com' }
          : null,
      };
    },
  );
}

/** Published route for a callsign. Plausibility is checked by the caller against the live position. */
export function getRoute(callsign: string): Promise<Omit<FlightRoute, 'plausible'> | null> {
  return routeCache.getOrLoad(
    callsign,
    (v) => (v ? 2 * HOUR : HOUR),
    async () => {
      const res = await adsbdb<{ flightroute: AdsbdbRoute }>(`/callsign/${encodeURIComponent(callsign)}`);
      const r = res?.flightroute;
      if (!r?.origin || !r?.destination) return null;
      return {
        callsign: r.callsign,
        airline: r.airline ? { name: r.airline.name, icao: r.airline.icao || null, iata: r.airline.iata || null } : null,
        origin: toAirport(r.origin),
        destination: toAirport(r.destination),
        source: 'adsbdb',
      };
    },
  );
}

/** airport-data.com photo by ICAO hex. Thumbnail URLs map to full-size images by id. */
export function getAirportDataPhoto(id: string): Promise<AircraftPhoto | null> {
  return photoCache.getOrLoad(
    id,
    (v) => (v ? 24 * HOUR : 6 * HOUR),
    async () => {
      try {
        const { data } = await fetchJson<{ status: number; data?: { image: string; link: string; photographer: string }[] }>(
          `https://airport-data.com/api/ac_thumb.json?m=${encodeURIComponent(id)}&n=1`,
          { timeoutMs: 10_000 },
        );
        const p = data.data?.[0];
        if (!p?.image) return null;
        const photoId = p.image.match(/(\d+)\.jpg$/)?.[1];
        return {
          thumbnail: p.image,
          large: photoId ? `https://image.airport-data.com/aircraft/${photoId}.jpg` : null,
          link: p.link || null,
          photographer: p.photographer || null,
          source: 'airport-data.com',
        };
      } catch (err) {
        if (!(err instanceof HttpError && err.status === 404)) console.warn(`[photo] ${id}: ${errorMessage(err)}`);
        return null;
      }
    },
  );
}

interface PlanespottersResponse {
  photos?: { thumbnail?: { src: string }; thumbnail_large?: { src: string }; link?: string; photographer?: string }[];
}

/** Planespotters.net photo, server-side. Returns null unless PLANESPOTTERS_CONTACT is configured. */
export function getPlanespottersPhoto(id: string): Promise<AircraftPhoto | null> {
  const contact = config.planespottersContact;
  if (!contact) return Promise.resolve(null);
  return planespottersCache.getOrLoad(
    id,
    (v) => (v ? 24 * HOUR : 6 * HOUR),
    async () => {
      try {
        const { data } = await fetchJson<PlanespottersResponse>(
          `https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(id)}`,
          { headers: { 'User-Agent': `FlightX/0.1 (+${contact})` }, timeoutMs: 10_000 },
        );
        const p = data.photos?.[0];
        const thumb = p?.thumbnail_large?.src ?? p?.thumbnail?.src;
        if (!p || !thumb) return null;
        return {
          thumbnail: thumb,
          large: p.thumbnail_large?.src ?? null,
          link: p.link ?? null,
          photographer: p.photographer ?? null,
          source: 'Planespotters.net',
        };
      } catch (err) {
        console.warn(`[planespotters] ${id}: ${errorMessage(err)}`);
        return null;
      }
    },
  );
}
