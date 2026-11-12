import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Small hover popups for any element with a `data-tip` attribute (airport
 * codes, times). One shared, fixed-position popup, so it never gets clipped
 * by scrolling panels.
 */
export function Tooltips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);

  useEffect(() => {
    const over = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (!el?.dataset.tip) return setTip(null);
      const r = el.getBoundingClientRect();
      const below = r.top < 44;
      setTip({ text: el.dataset.tip, x: r.left + r.width / 2, y: below ? r.bottom : r.top, below });
    };
    const hide = () => setTip(null);
    document.addEventListener('mouseover', over);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('mousedown', hide);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('mousedown', hide);
    };
  }, []);

  if (!tip) return null;
  const left = Math.min(window.innerWidth - 150, Math.max(150, tip.x));
  return createPortal(
    <div className={`tip${tip.below ? ' tip--below' : ''}`} style={{ left, top: tip.y }}>
      {tip.text}
    </div>,
    document.body,
  );
}
