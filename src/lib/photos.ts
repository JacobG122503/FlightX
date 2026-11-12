import type { AircraftPhoto } from '../../shared/types';

const cache = new Map<string, Promise<AircraftPhoto | null>>();

/** Representative photo of an aircraft type from Wikipedia. */
export function wikipediaPhoto(title: string): Promise<AircraftPhoto | null> {
  let p = cache.get(title);
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
          source: 'Wikipedia',
        };
      } catch {
        return null;
      }
    })();
    cache.set(title, p);
  }
  return p;
}
