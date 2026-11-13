import { useCallback, useEffect, useRef, useState } from 'react';

/** Mouse jitter right after `sleepNow` (e.g. the hand leaving the mouse) doesn't count as waking up. */
const GRACE_MS = 1200;

/**
 * True after `timeoutMs` with no mouse, keyboard, wheel or touch activity (only while `enabled`).
 * `sleepNow()` goes idle straight away (or as soon as `enabled` turns on).
 */
export function useIdle(timeoutMs: number, enabled: boolean): [boolean, () => void] {
  const [idle, setIdle] = useState(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const pending = useRef(false);
  const graceUntil = useRef(0);

  const sleepNow = useCallback(() => {
    if (enabledRef.current) {
      graceUntil.current = Date.now() + GRACE_MS;
      setIdle(true);
    } else {
      pending.current = true;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setIdle(false);
      return;
    }
    if (pending.current) {
      pending.current = false;
      graceUntil.current = Date.now() + GRACE_MS;
      setIdle(true);
    }
    let timer = window.setTimeout(() => setIdle(true), timeoutMs);
    const wake = (e: Event) => {
      if (e.type === 'mousemove' && Date.now() < graceUntil.current) return;
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), timeoutMs);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, wake);
    };
  }, [timeoutMs, enabled]);

  return [idle, sleepNow];
}
