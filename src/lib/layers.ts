/** deck.gl layer construction, kept free of React. */
import { IconLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { PathStyleExtension, type PathStyleExtensionProps } from '@deck.gl/extensions';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { aircraftIcon, hexRgba, PLANE_SIZE, planeColor, SIM_COLORS, zoomScale, type RGBA } from './icons';
import { extrapolate, greatCircle, unwrapLongitudes, type LatLon } from '../../shared/geo';
import type { Airport, FlightRoute, FlightState, TrackPoint } from '../../shared/types';

/** Callsign labels appear from this zoom, when not too crowded. */
export const LABEL_MIN_ZOOM = 8;
export const LABEL_MAX_COUNT = 600;

const dashExtension = new PathStyleExtension({ dash: true });
const ACCENT: RGBA = [56, 189, 248, 255];
const FONT = 'system-ui, -apple-system, sans-serif';
const OUTLINE: RGBA = [8, 11, 18, 255];

export type Position = [number, number];
export interface TrailPath {
  path: Position[];
  colors: RGBA[];
}
export interface RouteSegment {
  path: Position[];
}

export const toPos = (p: LatLon): Position => [p.lon, p.lat];

/** Flown path in the plane's colour, ending at its current position. */
export function buildTrail(trail: TrackPoint[], selected: FlightState | null, selectedPos: LatLon | null): TrailPath[] {
  if (!selected || !selectedPos || trail.length === 0) return [];
  const path = trail.map((p) => [p.lon, p.lat] as Position);
  path.push(toPos(selectedPos));
  const solid = hexRgba(selected.simRandom ? SIM_COLORS.random : SIM_COLORS.mine);
  return [{ path: unwrapLongitudes(path), colors: path.map(() => solid) }];
}

/** Dashed great circle to the destination (plus from the origin if there's no flown track). */
export function buildRoute(
  route: FlightRoute | null,
  selected: FlightState | null,
  selectedPos: LatLon | null,
  trailLength: number,
): RouteSegment[] {
  if (!route || !selected || !selectedPos || selected.onGround) return [];
  const segments: RouteSegment[] = [{ path: unwrapLongitudes(greatCircle(selectedPos, route.destination, 96).map(toPos)) }];
  if (trailLength < 2) segments.push({ path: unwrapLongitudes(greatCircle(route.origin, selectedPos, 96).map(toPos)) });
  return segments;
}

export interface LayerInput {
  /** All aircraft except the selected one. */
  others: FlightState[];
  /** Subset of `others` with callsigns (memoize to avoid relayout). */
  labeled: FlightState[];
  labelsOn: boolean;
  selected: FlightState | null;
  selectedPos: LatLon | null;
  trail: TrailPath[];
  route: RouteSegment[];
  airports: Airport[];
  zoom: number;
  /** Server-corrected time used for dead reckoning. */
  now: number;
  onHover?: (info: PickingInfo<FlightState>) => void;
}

export function buildFlightLayers(input: LayerInput): Layer[] {
  const { others, labeled, labelsOn, selected, selectedPos, trail, route, airports, zoom, now, onHover } = input;
  const sizeScale = zoomScale(zoom);
  const layers: Layer[] = [];

  if (trail.length) {
    layers.push(
      new PathLayer<TrailPath>({
        id: 'trail-casing',
        data: trail,
        getPath: (d) => d.path,
        getColor: [6, 9, 15, 200],
        getWidth: 7,
        widthUnits: 'pixels',
        jointRounded: true,
        capRounded: true,
      }),
      new PathLayer<TrailPath>({
        id: 'trail',
        data: trail,
        getPath: (d) => d.path,
        getColor: (d) => d.colors as unknown as RGBA,
        getWidth: 3.5,
        widthUnits: 'pixels',
        jointRounded: true,
        capRounded: true,
      }),
    );
  }

  if (route.length) {
    layers.push(
      new PathLayer<RouteSegment, PathStyleExtensionProps<RouteSegment>>({
        id: 'route',
        data: route,
        getPath: (d) => d.path,
        getColor: [235, 242, 255, 190],
        getWidth: 2,
        widthUnits: 'pixels',
        getDashArray: [5, 4],
        dashJustified: true,
        extensions: [dashExtension],
      }),
    );
  }

  layers.push(
    new IconLayer<FlightState>({
      id: 'aircraft',
      data: others,
      getIcon: (d) => aircraftIcon(d.kind, planeColor(d)),
      getPosition: (d) => toPos(extrapolate(d, now)),
      getAngle: (d) => -(d.trackDeg ?? 0),
      getSize: PLANE_SIZE,
      sizeScale,
      sizeUnits: 'pixels',
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 80],
      alphaCutoff: 0.05,
      onHover,
      updateTriggers: { getPosition: now },
    }),
  );

  if (labelsOn) {
    layers.push(
      new TextLayer<FlightState>({
        id: 'callsigns',
        data: labeled,
        getPosition: (d) => toPos(extrapolate(d, now)),
        getText: (d) => d.callsign ?? '',
        getSize: 11,
        getColor: [214, 224, 238, 230],
        getPixelOffset: [0, 20],
        fontFamily: FONT,
        fontWeight: 600,
        outlineWidth: 3,
        outlineColor: [8, 11, 18, 220],
        fontSettings: { sdf: true },
        updateTriggers: { getPosition: now },
      }),
    );
  }

  // Airports draw above traffic so their labels stay readable.
  if (airports.length) {
    layers.push(
      new ScatterplotLayer<Airport>({
        id: 'airports',
        data: airports,
        getPosition: toPos,
        getRadius: 5,
        radiusUnits: 'pixels',
        getFillColor: [11, 15, 23, 255],
        getLineColor: [235, 242, 255, 255],
        lineWidthUnits: 'pixels',
        getLineWidth: 2,
        stroked: true,
      }),
      new TextLayer<Airport>({
        id: 'airport-labels',
        data: airports,
        getPosition: toPos,
        getText: (a) => a.iata ?? a.icao ?? '',
        getSize: 13,
        getColor: [235, 242, 255, 255],
        getPixelOffset: [0, -16],
        fontFamily: FONT,
        fontWeight: 700,
        outlineWidth: 3,
        outlineColor: OUTLINE,
        fontSettings: { sdf: true },
      }),
    );
  }

  if (selected && selectedPos) {
    const data = [selected];
    const pos = toPos(selectedPos);
    layers.push(
      new ScatterplotLayer<FlightState>({
        id: 'selected-halo',
        data,
        getPosition: () => pos,
        getRadius: 22,
        radiusUnits: 'pixels',
        getFillColor: [56, 189, 248, 45],
        getLineColor: ACCENT,
        lineWidthUnits: 'pixels',
        getLineWidth: 2,
        stroked: true,
        updateTriggers: { getPosition: now },
      }),
      new IconLayer<FlightState>({
        id: 'aircraft-selected',
        data,
        getIcon: (d) => aircraftIcon(d.kind, planeColor(d), true),
        getPosition: () => pos,
        getAngle: (d) => -(d.trackDeg ?? 0),
        getSize: PLANE_SIZE * 1.35,
        sizeScale: Math.max(0.9, sizeScale),
        sizeUnits: 'pixels',
        pickable: true,
        onHover,
        updateTriggers: { getPosition: now },
      }),
      new TextLayer<FlightState>({
        id: 'selected-label',
        data,
        getPosition: () => pos,
        getText: (d) => d.callsign ?? d.reg ?? d.id.toUpperCase(),
        getSize: 13,
        getColor: [255, 255, 255, 255],
        getPixelOffset: [0, 30],
        fontFamily: FONT,
        fontWeight: 700,
        outlineWidth: 3,
        outlineColor: OUTLINE,
        fontSettings: { sdf: true },
        updateTriggers: { getPosition: now },
      }),
    );
  }

  return layers;
}
