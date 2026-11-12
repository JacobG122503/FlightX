import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { SimStatusResponse } from '../../shared/sim';

/** Simulation sidebar data (trips + flight log), refreshed every few seconds while in sim mode. */
export function useSimStatus(active: boolean) {
  const [status, setStatus] = useState<SimStatusResponse | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.sim.status());
    } catch {
      /* keep the last status */
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, [active, refresh]);

  return { status, refresh };
}
