import { useEffect, useState } from 'react';
import { serverNow } from '../api';

/** Re-renders every `intervalMs` and returns the current (server-corrected) time. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = window.setInterval(() => setNow(serverNow()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
