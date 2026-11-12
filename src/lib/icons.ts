/**
 * Aircraft silhouettes, drawn as SVG and handed to deck.gl's IconLayer.
 * All icons point north; the layer rotates them by track.
 * Shapes are defined by their right half and mirrored, so they're always symmetric.
 */
import type { AircraftKind } from '../../shared/types';
import { altitudeBucket, altitudeCss } from './altitude';

const SIZE = 64;
const OUTLINE = 'rgba(8, 11, 18, 0.9)';

type Pt = [number, number];

/** Builds a closed path from the right half (nose → tail, x ≥ 32), mirrored onto the left. */
function mirrored(right: Pt[]): string {
  const left = right
    .slice()
    .reverse()
    .map(([x, y]) => [SIZE - x, y] as Pt);
  const pts = [...right, ...left];
  return `M${pts.map(([x, y]) => `${x} ${y}`).join('L')}Z`;
}

const rect = (x: number, y: number, w: number, h: number, r = 1.2) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;

const SHAPES: Record<Exclude<AircraftKind, 'unknown'>, string> = {
  jet:
    `<path d="${mirrored([
      [32, 3], [33.7, 3.9], [34.8, 6], [35.2, 9], [35.2, 22], [58, 35.2], [58, 39], [35.2, 33.5],
      [35.2, 46.5], [43.5, 52.6], [43.5, 56], [34.2, 53.8], [32, 59],
    ])}"/>` +
    rect(42.2, 24.8, 3.6, 6.4) +
    rect(18.2, 24.8, 3.6, 6.4),
  heavy:
    `<path d="${mirrored([
      [32, 2], [34, 3], [35.3, 5.5], [35.8, 9], [35.8, 21], [60, 34.5], [60, 38.5], [35.8, 32.5],
      [35.8, 46], [44.5, 52.5], [44.5, 56], [34.5, 54], [32, 60],
    ])}"/>` +
    rect(40.6, 23.4, 3.4, 6.2) +
    rect(48.6, 28, 3.4, 6.2) +
    rect(20, 23.4, 3.4, 6.2) +
    rect(12, 28, 3.4, 6.2),
  light:
    `<path d="${mirrored([
      [32, 10], [33.4, 10.6], [34.4, 13], [34.4, 21.5], [58, 21.5], [58, 28], [34.4, 28],
      [33.4, 46], [42, 47.5], [42, 52.5], [33, 52.5], [32, 55],
    ])}"/>` + rect(25, 7, 14, 2.2, 1),
  glider: `<path d="${mirrored([
    [32, 12], [33.2, 13], [33.6, 16], [33.6, 23.5], [62, 25.6], [62, 27.6], [33.6, 28.6],
    [33, 49.5], [39.5, 50.2], [39.5, 53], [32.8, 53], [32, 54.5],
  ])}"/>`,
  heli:
    `<ellipse cx="32" cy="27" rx="7.5" ry="10.5"/>` +
    rect(30.6, 35, 2.8, 20, 1) +
    rect(25.5, 51.5, 13, 2.8, 1) +
    `<g transform="rotate(45 32 27)">${rect(30.7, 3, 2.6, 48, 1.3)}${rect(8, 25.7, 48, 2.6, 1.3)}</g>`,
  ground: rect(24, 20, 16, 24, 4),
};

function svg(kind: AircraftKind, fill: string, highlight: boolean): string {
  const shape = SHAPES[kind === 'unknown' ? 'jet' : kind];
  const stroke = highlight ? '#ffffff' : OUTLINE;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<g fill="${fill}" stroke="${stroke}" stroke-width="${highlight ? 3.2 : 2.6}" stroke-linejoin="round" paint-order="stroke">${shape}</g>` +
    `</svg>`
  );
}

export interface IconDef {
  id: string;
  url: string;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  mask: false;
}

const cache = new Map<string, IconDef>();

/** Icon for an aircraft: shape by kind, fill colour by altitude band. */
export function aircraftIcon(kind: AircraftKind, altFt: number | null, onGround: boolean, highlight = false): IconDef {
  const bucket = altitudeBucket(altFt, onGround);
  const id = `${kind}:${bucket}:${highlight ? 1 : 0}`;
  let icon = cache.get(id);
  if (!icon) {
    const fill = altitudeCss(bucket < 0 ? 0 : bucket, bucket < 0);
    icon = {
      id,
      url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg(kind, fill, highlight))}`,
      width: SIZE,
      height: SIZE,
      anchorX: SIZE / 2,
      anchorY: SIZE / 2,
      mask: false,
    };
    cache.set(id, icon);
  }
  return icon;
}

/** Base on-screen size in pixels for each kind (before zoom scaling). */
export const ICON_SIZE: Record<AircraftKind, number> = {
  heavy: 32,
  jet: 26,
  unknown: 26,
  light: 20,
  glider: 22,
  heli: 22,
  ground: 12,
};

/** Shrinks icons when zoomed far out so the world view isn't a solid carpet of planes. */
export function zoomScale(zoom: number): number {
  return Math.max(0.5, Math.min(1.15, 0.45 + (zoom - 2) * 0.11));
}
