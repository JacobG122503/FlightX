import { useEffect, useState } from 'react';
import { api } from '../api';
import { wikipediaPhoto } from '../lib/photos';
import type { AircraftPhoto, FlightDetailResponse, TrackPoint } from '../../shared/types';

const DETAIL_POLL_MS = 4_000;
const TRACK_REFRESH_MS = 60_000;

/** Combines a fetched track with newer points that arrived after it. */
function mergeTrail(base: TrackPoint[], recent: TrackPoint[]): TrackPoint[] {
  const lastT = base[base.length - 1]?.t ?? 0;
  return [...base, ...recent.filter((p) => p.t > lastT + 1000)];
}

export interface SelectedFlight {
  detail: FlightDetailResponse | null;
  trail: TrackPoint[];
  photo: AircraftPhoto | null;
  photoLoading: boolean;
  error: string | null;
}

const EMPTY: SelectedFlight = { detail: null, trail: [], photo: null, photoLoading: false, error: null };

/** Details, flown path and a photo of the aircraft type for the selected flight. */
export function useFlightDetail(id: string | null, active: boolean): SelectedFlight {
  const [detail, setDetail] = useState<FlightDetailResponse | null>(null);
  const [trail, setTrail] = useState<TrackPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<AircraftPhoto | null | undefined>(undefined);

  // Reset when the selection changes.
  useEffect(() => {
    setDetail(null);
    setTrail([]);
    setError(null);
    setPhoto(undefined);
  }, [id]);

  // Poll details.
  useEffect(() => {
    if (!id || !active) return;
    const ctrl = new AbortController();
    let timer: number | undefined;
    const run = async () => {
      try {
        const res = await api.detail(id, ctrl.signal);
        if (res.id !== id) return;
        setDetail(res);
        setError(null);
        const s = res.state;
        if (s) setTrail((prev) => mergeTrail(prev, [{ t: s.ts, lat: s.lat, lon: s.lon, altFt: s.altFt, onGround: s.onGround }]));
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
  }, [id, active]);

  // Fetch the flown track, then refresh it occasionally (polled positions fill the gaps).
  useEffect(() => {
    if (!id || !active) return;
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const res = await api.track(id, ctrl.signal);
        setTrail((prev) => mergeTrail(res.points, prev));
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
  }, [id, active]);

  // A representative photo of the aircraft type from Wikipedia.
  const wikiTitle = detail?.sim?.wikipediaTitle ?? null;
  useEffect(() => {
    if (!id || !wikiTitle) return;
    let cancelled = false;
    wikipediaPhoto(wikiTitle).then((p) => !cancelled && setPhoto(p));
    return () => {
      cancelled = true;
    };
  }, [id, wikiTitle]);

  if (!id) return EMPTY;
  return { detail, trail, photo: photo ?? null, photoLoading: photo === undefined && !(detail && !wikiTitle), error };
}
