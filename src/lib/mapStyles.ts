/**
 * The basemap: Esri World Imagery satellite photos, the real-time night side, and
 * borders/place names drawn from OpenFreeMap vector tiles (OpenStreetMap data).
 * All free and keyless. Only country and state/province borders are drawn — no county
 * or other local boundaries.
 */
import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';
import { nightBucket, nightTiles, registerNightProtocol } from './night';

registerNightProtocol();

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const FONT_REGULAR = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];
const NAME: ExpressionSpecification = ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name']];
const LABEL_HALO = { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.4, 'text-halo-blur': 0.5 };

export const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    imagery: {
      type: 'raster',
      tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 19,
    },
    // Real-time night side with city lights (see night.ts).
    night: {
      type: 'raster',
      tiles: nightTiles(nightBucket()),
      tileSize: 256,
      maxzoom: 8,
    },
    osm: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
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
    // State / province borders (admin level 4) — counties (level 6+) are left out on purpose.
    {
      id: 'border-state',
      type: 'line',
      source: 'osm',
      'source-layer': 'boundary',
      minzoom: 3,
      filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
      paint: {
        'line-color': 'rgba(255,255,255,0.45)',
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 10, 1.4],
        'line-dasharray': [3, 2],
      },
    },
    // Country borders.
    {
      id: 'border-country',
      type: 'line',
      source: 'osm',
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1], ['!=', ['get', 'disputed'], 1]],
      paint: {
        'line-color': 'rgba(255,255,255,0.75)',
        'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.6, 6, 1.4, 10, 2.2],
      },
    },
    // Towns and cities.
    {
      id: 'label-city',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'place',
      minzoom: 4,
      filter: ['match', ['get', 'class'], ['city', 'town'], true, false],
      layout: {
        'text-field': NAME,
        'text-font': FONT_REGULAR,
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 10, 15],
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
        'text-max-width': 8,
      },
      paint: LABEL_HALO,
    },
    // States / provinces.
    {
      id: 'label-state',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'place',
      minzoom: 3.5,
      maxzoom: 8,
      filter: ['==', ['get', 'class'], 'state'],
      layout: {
        'text-field': NAME,
        'text-font': FONT_REGULAR,
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 7, 13],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.12,
        'text-max-width': 9,
      },
      paint: { ...LABEL_HALO, 'text-color': 'rgba(255,255,255,0.75)' },
    },
    // Countries.
    {
      id: 'label-country',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'place',
      maxzoom: 7,
      filter: ['==', ['get', 'class'], 'country'],
      layout: {
        'text-field': NAME,
        'text-font': FONT_BOLD,
        'text-size': ['interpolate', ['linear'], ['zoom'], 1, 10, 5, 15],
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
        'text-max-width': 8,
      },
      paint: LABEL_HALO,
    },
  ],
};
