import { useEffect, useState } from 'react';
import { api, serverNow } from '../api';
import type { Bounds, FlightListResponse } from '../../shared/types';

export interface MapView {
  bounds: Bounds;
  zoom: number;
}

const MIN_POLL_MS = 3_000;
const MAX_POLL_MS = 600_000;
const ERROR_RETRY_MS = 10_000;

/** Fetches simulated aircraft for the current viewport and keeps polling at the rate the server suggests. */
export function useFlights(view: MapView | null, active: boolean) {
  const [data, setData] = useState<FlightListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Server-clock time of the next scheduled refresh (for "next update in …"). */
  const [nextAt, setNextAt] = useState<number | null>(null);

  useEffect(() => {
    if (!view || !active) return;
    const ctrl = new AbortController();
    let timer: number | undefined;

    const run = async () => {
      setLoading(true);
      try {
        const res = await api.flights(view.bounds, ctrl.signal);
        const delay = Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, res.refreshInMs));
        setData(res);
        setError(null);
        setNextAt(serverNow() + delay);
        timer = window.setTimeout(run, delay);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setNextAt(serverNow() + ERROR_RETRY_MS);
        timer = window.setTimeout(run, ERROR_RETRY_MS);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    };

    // Small debounce so rapid pans/zooms collapse into one request.
    timer = window.setTimeout(run, 150);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [view, active]);

  return { data, error, loading, nextAt };
}

/**
 * True when the map moved enough to warrant a refetch. Tiny pans (e.g. from
 * follow mode) don't trigger requests; the padded server response covers them.
 */
export function viewChanged(prev: MapView | null, next: MapView): boolean {
  if (!prev) return true;
  if (Math.round(prev.zoom) !== Math.round(next.zoom)) return true;
  const latSpan = Math.max(1e-6, prev.bounds.north - prev.bounds.south);
  const lonSpan = Math.max(1e-6, Math.abs(prev.bounds.east - prev.bounds.west));
  const dLat = Math.abs((prev.bounds.north + prev.bounds.south) / 2 - (next.bounds.north + next.bounds.south) / 2);
  const dLon = Math.abs((prev.bounds.east + prev.bounds.west) / 2 - (next.bounds.east + next.bounds.west) / 2);
  return dLat / latSpan > 0.08 || dLon / lonSpan > 0.08;
}
