/**
 * Real-time day/night on the map: NASA's "Black Marble" city-lights imagery
 * (free, via NASA GIBS) blended over the daytime satellite photo according to
 * where the sun actually is right now, with a smooth twilight band.
 *
 * Implemented as a MapLibre custom protocol ("night://z/x/y"): each tile is the
 * night image with per-pixel transparency from the sun's elevation, so it sits
 * between the satellite imagery and the place names.
 */
import maplibregl from 'maplibre-gl';

const NASA = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8';
const TILE = 256;
/** sin(-12°): full darkness below this sun elevation (nautical twilight). */
const SIN_DARK = Math.sin((-12 * Math.PI) / 180);
/** sin(+1°): fully daylight above this. */
const SIN_LIGHT = Math.sin((1 * Math.PI) / 180);

/** Where the sun is overhead right now (declination and longitude, radians). */
export function subsolarPoint(date = new Date()): { dec: number; lon: number } {
  const d = date.getTime() / 86_400_000 + 2440587.5 - 2451545.0; // days since J2000
  const g = ((357.529 + 0.98560028 * d) * Math.PI) / 180; // mean anomaly
  const q = 280.459 + 0.98564736 * d; // mean longitude (deg)
  const L = ((q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * Math.PI) / 180; // ecliptic longitude
  const e = ((23.439 - 0.00000036 * d) * Math.PI) / 180; // obliquity
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24; // hours
  let lon = ra - (gmst * 15 * Math.PI) / 180;
  lon = Math.atan2(Math.sin(lon), Math.cos(lon));
  return { dec, lon };
}

const images = new Map<string, Promise<ImageBitmap | null>>();

function nightImage(z: number, x: number, y: number): Promise<ImageBitmap | null> {
  const key = `${z}/${x}/${y}`;
  let p = images.get(key);
  if (!p) {
    p = fetch(`${NASA}/${z}/${y}/${x}.png`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => (b ? createImageBitmap(b) : null))
      .catch(() => null);
    images.set(key, p);
    if (images.size > 600) images.delete(images.keys().next().value as string);
  }
  return p;
}

async function renderTile(z: number, x: number, y: number): Promise<ArrayBuffer> {
  const canvas = new OffscreenCanvas(TILE, TILE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const img = await nightImage(z, x, y);
  if (img) {
    ctx.drawImage(img, 0, 0, TILE, TILE);
    const data = ctx.getImageData(0, 0, TILE, TILE);
    const px = data.data;
    const { dec, lon: sunLon } = subsolarPoint();
    const sinDec = Math.sin(dec);
    const cosDec = Math.cos(dec);
    const n = 2 ** z;
    // Per-column cos(Δlongitude) and per-row sin/cos(latitude) keep the per-pixel work tiny.
    const cosDLon = new Float32Array(TILE);
    for (let c = 0; c < TILE; c++) {
      const lon = ((x + (c + 0.5) / TILE) / n) * 2 * Math.PI - Math.PI;
      cosDLon[c] = Math.cos(lon - sunLon);
    }
    for (let r = 0; r < TILE; r++) {
      const merc = Math.PI * (1 - (2 * (y + (r + 0.5) / TILE)) / n);
      const lat = Math.atan(Math.sinh(merc));
      const a = Math.sin(lat) * sinDec;
      const b = Math.cos(lat) * cosDec;
      for (let c = 0; c < TILE; c++) {
        const sinElev = a + b * cosDLon[c];
        let t = (SIN_LIGHT - sinElev) / (SIN_LIGHT - SIN_DARK);
        t = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); // smoothstep twilight
        px[(r * TILE + c) * 4 + 3] = Math.round(255 * t * 0.97);
      }
    }
    ctx.putImageData(data, 0, 0);
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return blob.arrayBuffer();
}

let registered = false;

/** Registers the night:// tile protocol with MapLibre (once). */
export function registerNightProtocol() {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol('night', async (params) => {
    const m = /night:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    if (!m) throw new Error(`bad night tile url ${params.url}`);
    return { data: await renderTile(Number(m[1]), Number(m[2]), Number(m[3])) };
  });
}

/** Tile URL template; `bucket` changes every few minutes so tiles re-render as the Earth turns. */
export const nightTiles = (bucket: number) => [`night://{z}/{x}/{y}?t=${bucket}`];
export const NIGHT_REFRESH_MS = 5 * 60_000;
export const nightBucket = () => Math.floor(Date.now() / NIGHT_REFRESH_MS);
