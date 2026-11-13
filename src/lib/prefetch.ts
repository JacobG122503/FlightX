/**
 * Follow mode: load the map ahead of the plane so you never see tiles pop in at the edge it's
 * flying towards. Twice a second, works out where the camera will be over the next ~20 s and
 * fetches the satellite and border/label tiles for those views into the browser's HTTP cache;
 * when MapLibre asks for them they come straight from the cache.
 */
import { useEffect, useRef } from 'react';
import type { Map as MapLibreMap, RasterTileSource, VectorTileSource } from 'maplibre-gl';
import { destinationPoint } from '../../shared/geo';
import type { FlightState } from '../../shared/types';

const KM_PER_NM = 1.852;
/** How far ahead (seconds of flying) to load. */
const LEADS_SEC = [1.5, 4, 8, 14, 20];
/** Extra tiles around each predicted view. */
const MARGIN = 1;
const TICK_MS = 500;
/** Fetches started per tick (keeps the network free for what's on screen). */
const MAX_PER_TICK = 48;

interface Source {
  id: string;
  /** MapLibre's tile size for the source (256 raster, 512 vector). */
  tileSize: number;
  maxzoom: number;
  /** Raster sources pick the nearest zoom; vector sources round down. */
  round: boolean;
}

const SOURCES: Source[] = [
  { id: 'imagery', tileSize: 256, maxzoom: 19, round: true },
  { id: 'osm', tileSize: 512, maxzoom: 14, round: false },
];

const mercX = (lon: number) => (lon + 180) / 360;
const mercY = (lat: number) => {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

function tileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

export function usePrefetchAhead(map: MapLibreMap | undefined, follow: boolean, state: FlightState | null) {
  const stateRef = useRef(state);
  stateRef.current = state;

  // Fading new imagery in looks like loading while the camera keeps moving: draw it at once instead.
  useEffect(() => {
    if (!map) return;
    const set = (ms: number) => {
      if (map.getLayer('imagery')) map.setPaintProperty('imagery', 'raster-fade-duration', ms);
    };
    if (follow) set(0);
    return () => set(300);
  }, [map, follow]);

  useEffect(() => {
    if (!map || !follow) return;
    const requested = new Set<string>();
    const queue: string[] = [];

    const tick = () => {
      const s = stateRef.current;
      if (!s || s.onGround || !s.gsKt || s.trackDeg == null || s.gsKt < 30) return;
      const canvas = map.getCanvas();
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const zoom = map.getZoom();
      const center = map.getCenter();
      // Half the view, as a fraction of the world (MapLibre's world is 512 px wide at zoom 0).
      const worldPx = 512 * 2 ** zoom;
      const halfW = w / 2 / worldPx;
      const halfH = h / 2 / worldPx;

      for (const src of SOURCES) {
        const source = map.getSource(src.id) as RasterTileSource | VectorTileSource | undefined;
        const template = source?.tiles?.[0];
        if (!template) continue;
        const zf = zoom + Math.log2(512 / src.tileSize);
        const z = Math.max(0, Math.min(src.maxzoom, src.round ? Math.round(zf) : Math.floor(zf)));
        const n = 2 ** z;
        for (const lead of LEADS_SEC) {
          const p = destinationPoint({ lat: center.lat, lon: center.lng }, s.trackDeg, (s.gsKt * KM_PER_NM * lead) / 3600);
          const cx = mercX(p.lon);
          const cy = mercY(p.lat);
          const x0 = Math.floor((cx - halfW) * n) - MARGIN;
          const x1 = Math.floor((cx + halfW) * n) + MARGIN;
          const y0 = Math.max(0, Math.floor((cy - halfH) * n) - MARGIN);
          const y1 = Math.min(n - 1, Math.floor((cy + halfH) * n) + MARGIN);
          for (let x = x0; x <= x1; x++) {
            const wx = ((x % n) + n) % n; // wrap across the date line
            for (let y = y0; y <= y1; y++) {
              const url = tileUrl(template, z, wx, y);
              if (requested.has(url)) continue;
              requested.add(url);
              queue.push(url);
            }
          }
        }
      }

      for (const url of queue.splice(0, MAX_PER_TICK)) {
        fetch(url).catch(() => undefined);
      }
      if (requested.size > 20_000) requested.clear();
    };

    tick();
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, [map, follow]);
}
