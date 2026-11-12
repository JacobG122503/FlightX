import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import type { PickingInfo } from '@deck.gl/core';
import { DeckOverlay } from './DeckOverlay';
import { HoverCard } from './HoverCard';
import { useNow } from '../hooks/useNow';
import { buildFlightLayers, buildRoute, buildTrail, LABEL_MAX_COUNT, LABEL_MIN_ZOOM, type ColorMode } from '../lib/layers';
import { extrapolate } from '../../shared/geo';
import { BOOM_MS, explosionLayers, onExplode, shakeMap, type Boom } from '../lib/explosion';
import type { Airport, FlightRoute, FlightState, TrackPoint } from '../../shared/types';

/** How often positions are re-extrapolated (ms). */
const FRAME_MS = 250;

interface Props {
  flights: FlightState[];
  selectedId: string | null;
  selectedState: FlightState | null;
  route: FlightRoute | null;
  trail: TrackPoint[];
  zoom: number;
  follow: boolean;
  /** Show only the selected aircraft. */
  hideOthers: boolean;
  /** Altitude colours (live) or ground/random/yours colours (simulation). */
  colorMode: ColorMode;
  onSelect: (id: string | null) => void;
}

interface Hover {
  flight: FlightState;
  x: number;
  y: number;
}

/** React glue between app state and the deck.gl overlay. Render as a child of <Map>. */
export function FlightLayers({ flights, selectedId, selectedState, route, trail, zoom, follow, hideOthers, colorMode, onSelect }: Props) {
  const map = useMap().current;
  const now = useNow(FRAME_MS);
  const [hover, setHover] = useState<Hover | null>(null);
  const pointerRef = useRef(false);
  const lastPan = useRef(0);

  // Crash explosions: animate at full frame rate while any are playing.
  const [booms, setBooms] = useState<Boom[]>([]);
  const [frame, setFrame] = useState(0);
  useEffect(
    () =>
      onExplode((b) => {
        setBooms((prev) => [...prev, b]);
        shakeMap();
      }),
    [],
  );
  useEffect(() => {
    if (!booms.length) return;
    let raf = 0;
    const tick = () => {
      const t = performance.now();
      setFrame(t);
      setBooms((prev) => {
        const alive = prev.filter((b) => t - b.start < BOOM_MS);
        return alive.length === prev.length ? prev : alive;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [booms.length]);

  const others = useMemo(
    () => (hideOthers && selectedId ? [] : selectedId ? flights.filter((f) => f.id !== selectedId) : flights),
    [flights, selectedId, hideOthers],
  );
  // Parked aircraft crowd airports, so only airborne traffic gets labels (hover still works).
  const labeled = useMemo(() => others.filter((f) => f.callsign && !f.onGround), [others]);
  const airports = useMemo<Airport[]>(() => (route?.plausible ? [route.origin, route.destination] : []), [route]);
  const selectedPos = selectedState ? extrapolate(selectedState, now) : null;

  // Follow mode: keep the selected aircraft centred.
  useEffect(() => {
    if (!map || !follow || !selectedPos || now - lastPan.current < 1000) return;
    lastPan.current = now;
    map.easeTo({ center: [selectedPos.lon, selectedPos.lat], duration: 900, easing: (t) => t });
  }, [map, follow, selectedPos, now]);

  const onHover = useCallback(
    (info: PickingInfo<FlightState>) => {
      const flight = info.object;
      const pointer = Boolean(flight);
      if (map && pointerRef.current !== pointer) {
        pointerRef.current = pointer;
        map.getCanvas().style.cursor = pointer ? 'pointer' : '';
      }
      setHover(flight ? { flight, x: info.x, y: info.y } : null);
    },
    [map],
  );

  const onClick = useCallback(
    (info: PickingInfo) => {
      const obj = info.object as FlightState | undefined;
      onSelect(obj && info.layer?.id.startsWith('aircraft') ? obj.id : null);
    },
    [onSelect],
  );

  const overlayProps = useMemo(
    () => ({
      layers: [
        ...buildFlightLayers({
        others,
        labeled,
        labelsOn: zoom >= LABEL_MIN_ZOOM && flights.length <= LABEL_MAX_COUNT,
        selected: selectedState,
        selectedPos,
        trail: buildTrail(trail, selectedState, selectedPos, colorMode),
        route: buildRoute(route, selectedState, selectedPos, trail.length),
        airports,
        zoom,
        now,
        onHover,
        colorMode,
        }),
        ...explosionLayers(booms, frame, zoom),
      ],
      onClick,
      pickingRadius: 6,
    }),
    // selectedPos is derived from selectedState + now, both listed.
    [others, labeled, zoom, flights.length, selectedState, trail, route, airports, now, onHover, onClick, booms, frame, colorMode],
  );

  return (
    <>
      <DeckOverlay {...overlayProps} />
      {hover && <HoverCard flight={hover.flight} x={hover.x} y={hover.y} />}
    </>
  );
}
