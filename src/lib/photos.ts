/**
 * Aircraft photos from Planespotters.net, fetched directly by the browser
 * (their API allows cross-origin use; it rejects server requests without a
 * contact address). Their terms require crediting the photographer and
 * linking back to the photo page, which the panel does.
 */
import type { AircraftPhoto } from '../../shared/types';

interface PlanespottersResponse {
  photos?: {
    thumbnail?: { src: string };
    thumbnail_large?: { src: string };
    link?: string;
    photographer?: string;
  }[];
}

const cache = new Map<string, Promise<AircraftPhoto | null>>();

export function planespottersPhoto(hex: string): Promise<AircraftPhoto | null> {
  let p = cache.get(hex);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(`https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(hex)}`);
        if (!res.ok) return null;
        const photo = ((await res.json()) as PlanespottersResponse).photos?.[0];
        const thumb = photo?.thumbnail_large?.src ?? photo?.thumbnail?.src;
        if (!photo || !thumb) return null;
        return {
          thumbnail: thumb,
          large: photo.thumbnail_large?.src ?? null,
          link: photo.link ?? null,
          photographer: photo.photographer ?? null,
          source: 'Planespotters.net',
        };
      } catch {
        return null;
      }
    })();
    cache.set(hex, p);
  }
  return p;
}

const wikiCache = new Map<string, Promise<AircraftPhoto | null>>();

/** Representative photo of an aircraft type from Wikipedia (used for simulated planes). */
export function wikipediaPhoto(title: string): Promise<AircraftPhoto | null> {
  let p = wikiCache.get(title);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
        if (!res.ok) return null;
        const data = (await res.json()) as {
          thumbnail?: { source: string };
          originalimage?: { source: string };
          content_urls?: { desktop?: { page?: string } };
        };
        const thumb = data.thumbnail?.source;
        if (!thumb) return null;
        return {
          thumbnail: thumb,
          large: data.originalimage?.source ?? null,
          link: data.content_urls?.desktop?.page ?? null,
          photographer: null,
          source: 'Wikipedia (representative photo)',
        };
      } catch {
        return null;
      }
    })();
    wikiCache.set(title, p);
  }
  return p;
}
