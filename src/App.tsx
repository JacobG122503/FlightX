import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, { AttributionControl, MapProvider, useMap, type MapRef } from 'react-map-gl/maplibre';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { FlightLayers } from './components/FlightLayers';
import { FlightPanel } from './components/FlightPanel';
import { TopBar } from './components/TopBar';
import { Legend } from './components/Legend';
import { MapControls } from './components/MapControls';
import { SimSidebar } from './components/sim/SimSidebar';
import { useSimStatus } from './hooks/useSim';
import { explode } from './lib/explosion';
import { useFlights, viewChanged, type MapView } from './hooks/useFlights';
import { useFlightDetail } from './hooks/useFlightDetail';
import { usePageVisible } from './hooks/usePageVisible';
import { SATELLITE_STYLE } from './lib/mapStyles';
import { api, serverNow } from './api';
import { extrapolate, greatCircle, normalizeLon, unwrapLongitudes } from '../shared/geo';
import type { Bounds, FlightState, SourceId } from '../shared/types';

// ── Remembered between runs: last view and map style. Safe if storage is unavailable. ──
const STORAGE_KEY = 'flightx:view';
interface Stored {
  lat: number;
  lng: number;
  zoom: number;
}
function loadStored(): Partial<Stored> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Stored>;
  } catch {
    return {};
  }
}
function saveStored(patch: Partial<Stored>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadStored(), ...patch }));
  } catch {
    /* ignore */
  }
}

const initial = loadStored();
const INITIAL_VIEW = { latitude: initial.lat ?? 32, longitude: initial.lng ?? -40, zoom: initial.zoom ?? 2.6 };
const hashId = () => window.location.hash.replace(/^#/, '').toLowerCase() || null;

function loadPref<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function savePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

const PANEL_W = 372;
const SIDEBAR_W = 360;

/** MapLibre can report longitudes beyond ±180 when world copies are visible. */
function toBounds(map: MaplibreMap): Bounds {
  const b = map.getBounds();
  let west = b.getWest();
  let east = b.getEast();
  if (east - west >= 360) {
    west = -180;
    east = 180;
  } else {
    west = normalizeLon(west);
    east = normalizeLon(east);
  }
  return { south: Math.max(-85, b.getSouth()), north: Math.min(85, b.getNorth()), west, east };
}

function newest(...states: (FlightState | null | undefined)[]): FlightState | null {
  let best: FlightState | null = null;
  for (const s of states) if (s && (!best || s.ts > best.ts)) best = s;
  return best;
}

export default function App() {
  return (
    <MapProvider>
      <FlightApp />
    </MapProvider>
  );
}

function FlightApp() {
  // FlightX always opens in Simulation mode.
  const [source, setSource] = useState<SourceId>('sim');
  const [sidebarOpen, setSidebarOpen] = useState(() => loadPref('flightx:sidebar', 'open', ['open', 'closed'] as const) === 'open');
  /** Crashed planes are hidden immediately, before the next refresh confirms they're gone. */
  const [crashed, setCrashed] = useState<Set<string>>(() => new Set());
  const map: MapRef | undefined = useMap().main;
  const visible = usePageVisible();
  const [view, setView] = useState<MapView | null>(null);
  const [zoom, setZoom] = useState(INITIAL_VIEW.zoom);
  const [selectedId, setSelectedId] = useState<string | null>(hashId);
  const [seed, setSeed] = useState<FlightState | null>(null);
  const [follow, setFollow] = useState(false);
  /** "Hide others" mode: only the selected aircraft is drawn. */
  const [focusOnly, setFocusOnly] = useState(false);
  /** Pan to the selected aircraft once its position is known (deep links, search results). */
  const panPending = useRef(Boolean(selectedId));

  const { data, error, nextAt } = useFlights(view, source, visible);
  const flights = useMemo(() => (data?.flights ?? []).filter((f) => !crashed.has(f.id)), [data, crashed]);
  const selected = useFlightDetail(selectedId, source, visible);
  const sim = useSimStatus(source === 'sim' && visible);
  const simMode = source === 'sim';

  const selectedState = useMemo(() => {
    if (!selectedId) return null;
    return newest(
      flights.find((f) => f.id === selectedId),
      selected.detail?.id === selectedId ? selected.detail.state : null,
      seed?.id === selectedId ? seed : null,
    );
  }, [flights, selectedId, selected.detail, seed]);

  // Keep the URL hash in sync (a reload keeps the selected flight).
  useEffect(() => {
    const url = selectedId ? `#${selectedId}` : window.location.pathname + window.location.search;
    window.history.replaceState(null, '', url);
  }, [selectedId]);

  useEffect(() => {
    if (!map || !selectedState || !panPending.current) return;
    panPending.current = false;
    const p = extrapolate(selectedState, serverNow());
    map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(7, map.getZoom()) });
  }, [map, selectedState]);

  const updateView = useCallback((m: MaplibreMap) => {
    const z = m.getZoom();
    const c = m.getCenter();
    const next: MapView = { bounds: toBounds(m), zoom: z };
    setView((prev) => (viewChanged(prev, next) ? next : prev));
    saveStored({ lat: c.lat, lng: c.lng, zoom: z });
  }, []);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setFollow(false);
    setFocusOnly(false);
    if (!id) setSeed(null);
  }, []);

  const pickFromSearch = useCallback((f: FlightState) => {
    setSeed(f);
    setSelectedId(f.id);
    setFollow(false);
    setFocusOnly(false);
    panPending.current = true;
  }, []);

  /** Zooms the map to the whole flight: origin, flown path, aircraft and the way to its destination. */
  const fitWholeFlight = useCallback(() => {
    if (!map || !selectedState) return;
    const pos = extrapolate(selectedState, serverNow());
    const route = selected.detail?.route;
    const pts: [number, number][] = [];
    if (route?.plausible) pts.push([route.origin.lon, route.origin.lat]);
    for (const p of selected.trail) pts.push([p.lon, p.lat]);
    pts.push([pos.lon, pos.lat]);
    if (route?.plausible) for (const p of greatCircle(pos, route.destination, 32)) pts.push([p.lon, p.lat]);
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    for (const [lon, lat] of unwrapLongitudes(pts)) {
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      // Leave room for the panels and the bars on top.
      {
        padding: simMode
          ? { top: 120, bottom: 70, left: (sidebarOpen ? SIDEBAR_W : 0) + 60, right: PANEL_W + 60 }
          : { top: 120, bottom: 70, left: PANEL_W + 60, right: 90 },
        maxZoom: 9,
        duration: 1200,
      },
    );
  }, [map, selectedState, selected.trail, selected.detail, simMode, sidebarOpen]);

  const changeSource = useCallback(
    (next: SourceId) => {
      if (next === source) return;
      setSource(next);
      select(null);
      setCrashed(new Set());
    },
    [source, select],
  );

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => {
      savePref('flightx:sidebar', open ? 'closed' : 'open');
      return !open;
    });
  }, []);

  /** From the simulation sidebar: select a flight and fly the map to it. */
  const selectSimFlight = useCallback((id: string) => {
    setSeed(null);
    setSelectedId(id);
    setFollow(false);
    setFocusOnly(false);
    panPending.current = true;
  }, []);

  const crashSelected = useCallback(async () => {
    if (!selectedId) return;
    try {
      const res = await api.sim.crash(selectedId);
      explode({ id: res.id, lon: res.lon, lat: res.lat, kind: res.kind as FlightState['kind'], trackDeg: res.trackDeg ?? 0, altFt: res.altFt });
      setCrashed((prev) => new Set(prev).add(res.id));
      select(null);
      void sim.refresh();
    } catch (err) {
      console.warn('crash failed', err);
    }
  }, [selectedId, select, sim]);

  const setFocus = useCallback(
    (on: boolean) => {
      setFocusOnly(on);
      if (on) fitWholeFlight();
    },
    [fitWholeFlight],
  );

  const zoomTo = useCallback(() => {
    if (!map || !selectedState) return;
    const p = extrapolate(selectedState, serverNow());
    map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(9, map.getZoom()) });
  }, [map, selectedState]);

  return (
    <div className={`app mode-${source}${selectedId ? ' has-panel' : ''}${simMode && sidebarOpen ? ' sidebar-open' : ''}`}>
      <div className="map-wrap">
        <Map
          id="main"
          initialViewState={INITIAL_VIEW}
          mapStyle={SATELLITE_STYLE}
          minZoom={1.5}
          maxZoom={18}
          dragRotate={false}
          pitchWithRotate={false}
          touchPitch={false}
          attributionControl={false}
          onLoad={(e) => updateView(e.target)}
          onMoveEnd={(e) => updateView(e.target)}
          // Quarter-step zoom is enough for icon sizing and avoids re-rendering on every frame.
          onZoom={(e) => setZoom(Math.round(e.viewState.zoom * 4) / 4)}
        >
          <AttributionControl compact position="bottom-right" />
          <FlightLayers
            flights={flights}
            selectedId={selectedId}
            selectedState={selectedState}
            route={selected.detail?.route ?? null}
            trail={selected.trail}
            zoom={zoom}
            follow={follow}
            hideOthers={focusOnly}
            onSelect={select}
          />
        </Map>
      </div>

      <div className="titlebar-drag" />
      <TopBar
        source={source}
        list={data}
        count={flights.length}
        error={error}
        nextAt={nextAt}
        focus={focusOnly ? selectedState : undefined}
        flights={flights}
        onPick={pickFromSearch}
        onSource={changeSource}
      />

      <div className="top-center">
        {focusOnly && selectedState && (
          <div className="focus-pill glass">
            Only showing <strong>{selectedState.callsign ?? selectedState.reg ?? selectedState.id.toUpperCase()}</strong>
            <button onClick={() => setFocusOnly(false)}>Show all planes</button>
          </div>
        )}
        {data?.notice && !error && <div className="notice glass">{data.notice}</div>}
      </div>

      {simMode && (
        <SimSidebar
          open={sidebarOpen}
          onToggle={toggleSidebar}
          status={sim.status}
          onChanged={() => void sim.refresh()}
          onSelectFlight={selectSimFlight}
        />
      )}

      {selectedId && (
        <FlightPanel
          key={selectedId}
          id={selectedId}
          state={selectedState}
          selected={selected}
          follow={follow}
          onFollow={setFollow}
          focus={focusOnly}
          onFocus={setFocus}
          onZoomTo={zoomTo}
          onClose={() => select(null)}
          onCrash={simMode ? crashSelected : undefined}
          side={simMode ? 'right' : 'left'}
        />
      )}

      <div className="bottom-left">
        <Legend />
        <div className="attribution">
          Flight data{' '}
          <a href="https://opensky-network.org" target="_blank" rel="noreferrer">OpenSky Network</a>,{' '}
          <a href="https://adsb.fi" target="_blank" rel="noreferrer">adsb.fi</a>,{' '}
          <a href="https://adsb.lol" target="_blank" rel="noreferrer">adsb.lol</a> (ODbL) · Routes{' '}
          <a href="https://www.adsbdb.com" target="_blank" rel="noreferrer">adsbdb</a>
          {simMode && (
            <>
              {' '}· Sim data{' '}
              <a href="https://ourairports.com/data/" target="_blank" rel="noreferrer">OurAirports</a>,{' '}
              <a href="https://github.com/vradarserver/standing-data" target="_blank" rel="noreferrer">Virtual Radar Server</a>,{' '}
              <a href="https://openflights.org/data" target="_blank" rel="noreferrer">OpenFlights</a> (time zones, ODbL)
            </>
          )}
        </div>
      </div>

      <MapControls />
    </div>
  );
}
