import { useEffect, useState } from 'react';
import { api } from '../api';
import { planespottersPhoto, wikipediaPhoto } from '../lib/photos';
import type { AircraftPhoto, FlightDetailResponse, SourceId, TrackPoint } from '../../shared/types';

const DETAIL_POLL_MS = 4_000;
const TRACK_REFRESH_MS = 60_000;

/** Combines a fetched track with live points that arrived after it. */
function mergeTrail(base: TrackPoint[], live: TrackPoint[]): TrackPoint[] {
  const lastT = base[base.length - 1]?.t ?? 0;
  return [...base, ...live.filter((p) => p.t > lastT + 1000)];
}

export interface SelectedFlight {
  detail: FlightDetailResponse | null;
  trail: TrackPoint[];
  trailSources: string[];
  photo: AircraftPhoto | null;
  photoLoading: boolean;
  error: string | null;
}

const EMPTY: SelectedFlight = { detail: null, trail: [], trailSources: [], photo: null, photoLoading: false, error: null };

/** Live details, flown path and photo for the selected aircraft. */
export function useFlightDetail(id: string | null, source: SourceId, active: boolean): SelectedFlight {
  const [detail, setDetail] = useState<FlightDetailResponse | null>(null);
  const [trail, setTrail] = useState<TrackPoint[]>([]);
  const [trailSources, setTrailSources] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [psPhoto, setPsPhoto] = useState<AircraftPhoto | null | undefined>(undefined);

  // Reset when the selection changes.
  useEffect(() => {
    setDetail(null);
    setTrail([]);
    setTrailSources([]);
    setError(null);
    setPsPhoto(undefined);
  }, [id]);

  // Poll live details.
  useEffect(() => {
    if (!id || !active) return;
    const ctrl = new AbortController();
    let timer: number | undefined;
    const run = async () => {
      try {
        const res = await api.detail(id, source, ctrl.signal);
        if (res.id !== id) return;
        setDetail(res);
        setError(null);
        const s = res.state;
        if (s) {
          setTrail((prev) =>
            mergeTrail(prev, [{ t: s.ts, lat: s.lat, lon: s.lon, altFt: s.altFt, onGround: s.onGround }]),
          );
        }
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      }
      if (!ctrl.signal.aborted) timer = window.setTimeout(run, DETAIL_POLL_MS);
    };
    run();
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [id, source, active]);

  // Fetch the flown track, then refresh it occasionally (live points fill the gaps in between).
  useEffect(() => {
    if (!id || !active) return;
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const res = await api.track(id, source, ctrl.signal);
        setTrail((prev) => mergeTrail(res.points, prev));
        setTrailSources(res.sources);
      } catch {
        /* the trail is optional */
      }
    };
    load();
    const timer = window.setInterval(load, TRACK_REFRESH_MS);
    return () => {
      ctrl.abort();
      window.clearInterval(timer);
    };
  }, [id, source, active]);

  // Live: Planespotters photo (browser-side), falling back to the server-provided one.
  // Simulated: a representative photo of the aircraft type from Wikipedia.
  const wikiTitle = detail?.sim?.wikipediaTitle ?? null;
  useEffect(() => {
    if (!id) return;
    if (source === 'sim' && !wikiTitle) return;
    let cancelled = false;
    (source === 'sim' ? wikipediaPhoto(wikiTitle!) : planespottersPhoto(id)).then((p) => !cancelled && setPsPhoto(p));
    return () => {
      cancelled = true;
    };
  }, [id, source, wikiTitle]);

  if (!id) return EMPTY;
  const photo = psPhoto ?? detail?.photo ?? null;
  const photoLoading = psPhoto === undefined || (psPhoto === null && !detail);
  return { detail, trail, trailSources, photo, photoLoading, error };
}
