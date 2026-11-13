/**
 * Aircraft silhouettes, drawn as SVG and handed to deck.gl's IconLayer.
 * All icons point north; the layer rotates them by track.
 * Shapes are defined by their right half and mirrored, so they're always symmetric.
 */
import type { AircraftKind, FlightState } from '../../shared/types';

export type RGBA = [number, number, number, number];

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

const SHAPES: Record<Exclude<AircraftKind, 'unknown' | 'walker' | 'swimmer'>, string> = {
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
  // Concorde: needle nose, slender ogival delta wing, four engines in two nacelles per side.
  delta:
    `<path d="${mirrored([
      [32, 1], [33.2, 4], [33.8, 10], [34, 20], [35.5, 27], [39, 33], [44, 40], [50, 47], [55, 53], [56, 56],
      [47, 56.5], [38, 57], [34, 57.5], [33.6, 61], [32, 63],
    ])}"/>` +
    rect(36.4, 47, 3, 10.5, 0.8) +
    rect(40.2, 47, 3, 10, 0.8) +
    rect(24.6, 47, 3, 10.5, 0.8) +
    rect(20.8, 47, 3, 10, 0.8),
  // B-2 Spirit: tailless flying wing with the sawtooth "W" trailing edge.
  wing: `<path d="${mirrored([
    [32, 14], [62, 36], [61, 40], [53, 44], [47, 40.5], [40, 45], [35, 41], [32, 43],
  ])}"/>`,
  // SR-71 Blackbird: chined fuselage, delta wing with an engine nacelle mid-span each side.
  blackbird:
    `<path d="${mirrored([
      [32, 2], [33, 6], [34.5, 14], [36, 24], [38.5, 30], [45, 35], [54, 44], [56.5, 49.5], [47, 50.5], [44.5, 56.5],
      [41.5, 57], [38.5, 52], [35, 53], [34, 60], [32, 62],
    ])}"/>` +
    rect(40.2, 28, 4.6, 26, 2.2) +
    rect(19.2, 28, 4.6, 26, 2.2),
  // Hindenburg: long cigar hull with cruciform tail fins.
  airship: `<ellipse cx="32" cy="31" rx="7.5" ry="27"/>` + rect(22, 50, 20, 4, 1.5) + rect(30.4, 47, 3.2, 14, 1.2),
  // X-59 QueSST: very long thin nose, small canards, swept wing set far back, T-tail.
  needle: `<path d="${mirrored([
    [32, 1], [32.6, 6], [33.2, 16], [33.8, 24], [36.5, 27], [36.5, 29], [34, 29.5], [34.2, 35], [38.5, 37], [50, 46],
    [50, 49], [35, 50.5], [35, 54], [41, 58], [41, 60.5], [34, 60.5], [32, 62.5],
  ])}"/>`,
};

function svg(kind: AircraftKind, fill: string, highlight: boolean): string {
  const shape = SHAPES[kind === 'unknown' || isPerson(kind) ? 'jet' : (kind as keyof typeof SHAPES)];
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

/** Plane colours: on the ground, randomly spawned, and sent by you. */
export const SIM_COLORS = { ground: '#8b95a5', random: '#FFD60A', mine: '#3CB371' } as const;

/** A plane's colour: grey on the ground, yellow if random, green if yours. */
export const planeColor = (f: Pick<FlightState, 'onGround' | 'simRandom'>) =>
  f.onGround ? SIM_COLORS.ground : f.simRandom ? SIM_COLORS.random : SIM_COLORS.mine;

export const hexRgba = (hex: string, a = 255): RGBA => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), a];

/** Icon for an aircraft: shape by kind, in the given colour. */
/** The Walk option: shown as an emoji in the flight panel. */
export const PERSON_EMOJI: Partial<Record<AircraftKind, string>> = { walker: '🚶', swimmer: '🏊' };
export const isPerson = (kind: AircraftKind) => kind in PERSON_EMOJI;

/**
 * Map pictograms for people, on a 24×24 grid (Material Design icons "directions_walk" and "pool",
 * Apache License 2.0). Both face right as drawn.
 */
const PERSON_GLYPH: Partial<Record<AircraftKind, string>> = {
  walker:
    '<circle cx="13.5" cy="3.5" r="2"/>' +
    '<path d="M9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"/>',
  swimmer:
    '<circle cx="16.5" cy="5.5" r="2.5"/>' +
    '<path d="M8.67 12c.56 0 .78-.13 1.15-.36.46-.27 1.08-.64 2.19-.64 1.11 0 1.73.37 2.18.64.37.22.6.36 1.15.36s.78-.13 1.15-.36c.12-.07.26-.15.41-.23L10.48 5C8.93 3.45 7.5 2.99 5 3v2.5c1.82-.01 2.89.39 4 1.5l1 1-3.25 3.25c.31.12.56.27.77.39.37.23.59.36 1.15.36z"/>' +
    '<path d="M22 16.5c-1.11 0-1.73-.37-2.18-.64-.37-.22-.6-.36-1.15-.36-.56 0-.78.13-1.15.36-.45.27-1.07.64-2.18.64s-1.73-.37-2.18-.64c-.37-.22-.6-.36-1.15-.36-.56 0-.78.13-1.15.36-.45.27-1.07.64-2.18.64s-1.73-.37-2.18-.64c-.37-.22-.6-.36-1.15-.36s-.78.13-1.15.36c-.47.27-1.09.64-2.2.64v-2c.56 0 .78-.13 1.15-.36.45-.27 1.07-.64 2.18-.64s1.73.37 2.18.64c.37.22.6.36 1.15.36.56 0 .78-.13 1.15-.36.45-.27 1.07-.64 2.18-.64s1.73.37 2.18.64c.37.22.6.36 1.15.36s.78-.13 1.15-.36c.45-.27 1.07-.64 2.18-.64s1.73.37 2.18.64c.37.22.6.36 1.15.36v2z"/>' +
    '<path d="M22 21c-1.11 0-1.73-.37-2.18-.64-.37-.22-.6-.36-1.15-.36-.56 0-.78.13-1.15.36-.46.27-1.07.64-2.18.64s-1.73-.37-2.18-.64c-.37-.22-.6-.36-1.15-.36-.56 0-.78.13-1.15.36-.46.27-1.08.64-2.19.64-1.11 0-1.73-.37-2.18-.64-.37-.23-.6-.36-1.15-.36s-.78.13-1.15.36c-.46.27-1.08.64-2.19.64v-2c.56 0 .78-.13 1.15-.36.46-.27 1.08-.64 2.19-.64s1.73.37 2.18.64c.37.23.59.36 1.15.36.56 0 .78-.13 1.15-.36.46-.27 1.08-.64 2.19-.64 1.11 0 1.73.37 2.18.64.37.22.6.36 1.15.36s.78-.13 1.15-.36c.45-.27 1.07-.64 2.18-.64s1.73.37 2.18.64c.37.23.59.36 1.15.36v2z"/>',
};

/** Pictogram on a disc in the plane colour (so yours vs random still shows); `faceRight` mirrors it. */
function personSvg(kind: AircraftKind, fill: string, highlight: boolean, faceRight: boolean): string {
  const flip = faceRight ? '' : ' translate(24 0) scale(-1 1)';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<circle cx="32" cy="32" r="28" fill="${fill}" stroke="${highlight ? '#ffffff' : OUTLINE}" stroke-width="${highlight ? 4 : 3}"/>` +
    `<g fill="#0b1018" transform="translate(13 13) scale(1.58)${flip}">${PERSON_GLYPH[kind]}</g>` +
    `</svg>`
  );
}

/**
 * Icon for an aircraft: shape by kind, in the given colour. People (Walk) are pictograms that don't
 * rotate; `faceRight` turns them to face the way they're heading.
 */
export function aircraftIcon(kind: AircraftKind, fill: string, highlight = false, faceRight = false): IconDef {
  const person = isPerson(kind);
  const id = `${kind}:${fill}:${highlight ? 1 : 0}${person && faceRight ? ':r' : ''}`;
  let icon = cache.get(id);
  if (!icon) {
    icon = {
      id,
      url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(person ? personSvg(kind, fill, highlight, faceRight) : svg(kind, fill, highlight))}`,
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

/** Every plane is drawn the same size (before zoom scaling); only the silhouette differs. */
export const PLANE_SIZE = 26;

/** Icon scale by zoom: planes get bigger when zoomed out so they're easy to see. */
export function zoomScale(zoom: number): number {
  return Math.max(1, Math.min(1.6, 1.6 - (zoom - 2) * 0.09));
}
