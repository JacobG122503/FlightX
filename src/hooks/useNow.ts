import { useEffect, useState } from 'react';
import { serverNow } from '../api';

/**
 * Re-renders every `intervalMs` (or every animation frame when 0) and returns the
 * current (server-corrected) time.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (intervalMs > 0) {
      const id = window.setInterval(() => setNow(serverNow()), intervalMs);
      return () => window.clearInterval(id);
    }
    let raf = 0;
    const tick = () => {
      setNow(serverNow());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [intervalMs]);
  return now;
}
