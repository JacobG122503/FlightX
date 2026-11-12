/**
 * The "crash" animation: a flash, expanding fireballs, debris arcing out under
 * gravity, drifting smoke and the aircraft spinning down — all deck.gl layers
 * drawn at the crash site, plus a quick shake of the map.
 */
import { IconLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { AircraftKind } from '../../shared/types';
import { aircraftIcon, ICON_SIZE } from './icons';
import type { RGBA } from './altitude';

export const BOOM_MS = 2800;

export interface Boom {
  id: string;
  lon: number;
  lat: number;
  kind: AircraftKind;
  trackDeg: number;
  altFt: number | null;
  start: number;
}

type Listener = (b: Boom) => void;
const listeners = new Set<Listener>();

/** Trigger an explosion at a position (picked up by the map layers). */
export function explode(b: Omit<Boom, 'start'>) {
  const boom = { ...b, start: performance.now() };
  for (const l of listeners) l(boom);
}

export function onExplode(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Pixel offset → position, at the current zoom (MapLibre uses 512 px tiles). */
function offset(b: Boom, dx: number, dy: number, zoom: number): [number, number] {
  const metersPerPx = (40075016.686 * Math.cos((b.lat * Math.PI) / 180)) / (512 * 2 ** zoom);
  const dLon = (dx * metersPerPx) / (111320 * Math.cos((b.lat * Math.PI) / 180));
  const dLat = (dy * metersPerPx) / 110540;
  return [b.lon + dLon, b.lat + dLat];
}

/** Deterministic pseudo-random numbers per explosion (stable across frames). */
function seeded(id: string, i: number): number {
  let h = 2166136261;
  for (const c of `${id}:${i}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (x: number) => 1 - (1 - x) ** 3;

interface Dot {
  position: [number, number];
  radius: number;
  color: RGBA;
  line?: RGBA;
}

export function explosionLayers(booms: Boom[], now: number, zoom: number): Layer[] {
  const fire: Dot[] = [];
  const smoke: Dot[] = [];
  const debris: Dot[] = [];
  const planes: { position: [number, number]; size: number; angle: number; boom: Boom }[] = [];

  for (const b of booms) {
    const p = (now - b.start) / BOOM_MS;
    if (p < 0 || p > 1) continue;
    const at = b.lon !== undefined ? ([b.lon, b.lat] as [number, number]) : ([0, 0] as [number, number]);

    // The aircraft tumbles and drops for the first moments.
    const fall = clamp01(p / 0.35);
    if (fall < 1) {
      planes.push({
        position: offset(b, 0, -28 * fall * fall, zoom),
        size: ICON_SIZE[b.kind] * 1.3 * (1 - fall * 0.8),
        angle: -b.trackDeg + fall * 540,
        boom: b,
      });
    }

    // Flash.
    const flash = clamp01(p / 0.12);
    if (flash < 1) fire.push({ position: at, radius: 14 + 70 * easeOut(flash), color: [255, 250, 220, Math.round(255 * (1 - flash))] });

    // Fireballs.
    for (const [i, delay] of [0.04, 0.1, 0.18].entries()) {
      const q = clamp01((p - delay) / 0.5);
      if (q <= 0 || q >= 1) continue;
      const r = 10 + (60 + i * 18) * easeOut(q);
      const fade = Math.round(230 * (1 - q));
      fire.push({
        position: offset(b, (seeded(b.id, i) - 0.5) * 18, (seeded(b.id, i + 9) - 0.3) * 14, zoom),
        radius: r,
        color: [255, Math.round(170 - 120 * q), Math.round(40 * (1 - q)), fade],
        line: [255, 230, 120, fade],
      });
    }

    // Core glow.
    const core = clamp01(p / 0.55);
    if (core < 1) fire.push({ position: at, radius: 16 + 22 * easeOut(core), color: [255, 214, 90, Math.round(240 * (1 - core))] });

    // Debris arcing out with gravity.
    for (let i = 0; i < 24; i++) {
      const angle = seeded(b.id, 100 + i) * Math.PI * 2;
      const speed = 70 + seeded(b.id, 200 + i) * 140;
      const dx = Math.cos(angle) * speed * easeOut(p);
      const dy = Math.sin(angle) * speed * easeOut(p) + 40 * p - 160 * p * p;
      const hot = i % 3 === 0;
      debris.push({
        position: offset(b, dx, dy, zoom),
        radius: hot ? 3 : 2.4,
        color: hot ? [255, 160, 40, Math.round(255 * (1 - p))] : [40, 36, 34, Math.round(255 * (1 - p * p))],
      });
    }

    // Smoke drifting up and out.
    for (let i = 0; i < 8; i++) {
      const q = clamp01((p - 0.15 - i * 0.03) / 0.8);
      if (q <= 0 || q >= 1) continue;
      const dx = (seeded(b.id, 300 + i) - 0.5) * 70 * q;
      const dy = 25 + 70 * q + seeded(b.id, 400 + i) * 20;
      smoke.push({ position: offset(b, dx, dy, zoom), radius: 12 + 30 * q, color: [60, 60, 64, Math.round(150 * (1 - q))] });
    }
  }

  if (!fire.length && !smoke.length && !debris.length && !planes.length) return [];
  const dots = (id: string, data: Dot[], stroked = false) =>
    new ScatterplotLayer<Dot>({
      id,
      data,
      getPosition: (d) => d.position,
      getRadius: (d) => d.radius,
      radiusUnits: 'pixels',
      getFillColor: (d) => d.color,
      getLineColor: (d) => d.line ?? [0, 0, 0, 0],
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      stroked,
      updateTriggers: { getPosition: now, getRadius: now, getFillColor: now, getLineColor: now },
    });

  return [
    dots('boom-smoke', smoke),
    new IconLayer<(typeof planes)[number]>({
      id: 'boom-plane',
      data: planes,
      getIcon: (d) => aircraftIcon(d.boom.kind, d.boom.altFt, false),
      getPosition: (d) => d.position,
      getSize: (d) => d.size,
      getAngle: (d) => d.angle,
      sizeUnits: 'pixels',
      updateTriggers: { getPosition: now, getSize: now, getAngle: now },
    }),
    dots('boom-fire', fire, true),
    dots('boom-debris', debris),
  ];
}

/** Shakes the map briefly. */
export function shakeMap() {
  const el = document.querySelector('.map-wrap');
  if (!el) return;
  el.classList.remove('shake');
  void (el as HTMLElement).offsetWidth; // restart the CSS animation
  el.classList.add('shake');
  window.setTimeout(() => el.classList.remove('shake'), 600);
}
