/**
 * Builds server/sources/sim/dataset/landmask.json: a land/sea grid used to fly Concorde
 * supersonic only over the ocean (it was banned from booming over land).
 *
 * Source: Natural Earth 1:50m land polygons (public domain), rasterized to a 0.25° grid.
 * Run: node scripts/build-landmask.mjs
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_50m_land.geojson';
const RES = 0.25;
const W = 360 / RES;
const H = 180 / RES;

const geo = await (await fetch(SRC)).json();
const bits = new Uint8Array(Math.ceil((W * H) / 8));
const set = (x, y) => {
  const i = y * W + x;
  bits[i >> 3] |= 1 << (i & 7);
};

// Even-odd scanline fill per polygon (outer ring + holes together), one scanline per grid row.
const fill = (rings) => {
  for (let y = 0; y < H; y++) {
    const lat = 90 - (y + 0.5) * RES;
    const xs = [];
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x1, y1] = ring[j];
        const [x2, y2] = ring[i];
        if (y1 > lat !== y2 > lat) xs.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.round((xs[k] + 180) / RES - 0.5));
      const b = Math.min(W - 1, Math.round((xs[k + 1] + 180) / RES - 0.5));
      for (let x = a; x <= b; x++) set(x, y);
    }
  }
};

for (const f of geo.features) {
  const g = f.geometry;
  if (g.type === 'Polygon') fill(g.coordinates);
  else if (g.type === 'MultiPolygon') for (const p of g.coordinates) fill(p);
}

let land = 0;
for (let i = 0; i < W * H; i++) if (bits[i >> 3] & (1 << (i & 7))) land++;
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/sources/sim/dataset/landmask.json');
writeFileSync(out, JSON.stringify({ source: 'Natural Earth 1:50m land (public domain)', res: RES, w: W, h: H, bits: Buffer.from(bits).toString('base64') }));
console.log(`landmask: ${W}×${H} cells, ${((land / (W * H)) * 100).toFixed(1)}% land → ${out}`);
