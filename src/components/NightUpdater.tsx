import { useEffect } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import type { RasterTileSource } from 'maplibre-gl';
import { NIGHT_REFRESH_MS, nightBucket, nightTiles } from '../lib/night';

/** Re-renders the night side every few minutes as the Earth turns. Render inside <Map>. */
export function NightUpdater() {
  const map = useMap().current;
  useEffect(() => {
    if (!map) return;
    const id = window.setInterval(() => {
      const source = map.getMap().getSource('night') as RasterTileSource | undefined;
      source?.setTiles(nightTiles(nightBucket()));
    }, NIGHT_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [map]);
  return null;
}
