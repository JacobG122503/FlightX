import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { SimStatusResponse, TripView } from '../../shared/sim';

/** Simulation sidebar data (trips + flight log), refreshed every few seconds while in sim mode. */
export function useSimStatus(active: boolean, view: TripView = 'newest') {
  const [status, setStatus] = useState<SimStatusResponse | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.sim.status(view));
    } catch {
      /* keep the last status */
    }
  }, [view]);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, [active, refresh]);

  return { status, refresh };
}
