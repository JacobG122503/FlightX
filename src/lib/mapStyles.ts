/**
 * The basemap: Esri World Imagery satellite photos + Esri borders/place-name overlay.
 * Free for non-commercial use with attribution (shown by the map's attribution control),
 * no API key needed.
 */
import type { StyleSpecification } from 'maplibre-gl';
import { nightBucket, nightTiles, registerNightProtocol } from './night';

registerNightProtocol();

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';

export const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    imagery: {
      type: 'raster',
      tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        'Imagery © <a href="https://www.esri.com" target="_blank">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community',
    },
    // Real-time night side with city lights (see night.ts).
    night: {
      type: 'raster',
      tiles: nightTiles(nightBucket()),
      tileSize: 256,
      maxzoom: 8,
    },
    places: {
      type: 'raster',
      tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'imagery',
      type: 'raster',
      source: 'imagery',
      // Slightly dimmed so the coloured aircraft stand out against the imagery.
      paint: { 'raster-brightness-max': 0.8, 'raster-saturation': -0.15, 'raster-contrast': 0.05 },
    },
    { id: 'night', type: 'raster', source: 'night', paint: { 'raster-fade-duration': 0 } },
    { id: 'places', type: 'raster', source: 'places', paint: { 'raster-opacity': 0.9 } },
  ],
};
