import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { fmtAltitude } from '../lib/format';
import { planeColor } from '../lib/icons';
import type { FlightState } from '../../shared/types';

interface Props {
  flights: FlightState[];
  onPick: (flight: FlightState) => void;
  /** Focus the box as soon as it appears. */
  autoFocus?: boolean;
  /** Escape pressed: the box can be put away. */
  onClose?: () => void;
}

const LOCAL_LIMIT = 8;
const TOTAL_LIMIT = 12;

function matches(f: FlightState, q: string): boolean {
  return Boolean(
    f.callsign?.startsWith(q) || f.reg?.replace(/-/g, '').startsWith(q.replace(/-/g, '')) || f.id.toUpperCase() === q,
  );
}

/** Find a flight by flight number, callsign, registration or airport — in view first, then anywhere. */
export function SearchBox({ flights, onPick, autoFocus, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<FlightState[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = query.trim().toUpperCase().replace(/\s+/g, '');

  const local = useMemo(() => {
    if (q.length < 2) return [];
    const out: FlightState[] = [];
    for (const f of flights) {
      if (matches(f, q)) out.push(f);
      if (out.length >= LOCAL_LIMIT) break;
    }
    return out;
  }, [flights, q]);

  useEffect(() => {
    setRemote([]);
    if (q.length < 3) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setSearching(true);
      try {
        setRemote((await api.search(q, ctrl.signal)).results);
      } catch {
        /* ignore */
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
      setSearching(false);
    };
  }, [q]);

  const results = useMemo(() => {
    const seen = new Set<string>();
    const out: FlightState[] = [];
    for (const f of [...local, ...remote]) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push(f);
    }
    return out.slice(0, TOTAL_LIMIT);
  }, [local, remote]);

  useEffect(() => setActive(0), [results.length]);

  // "/" focuses search, like many map tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pick = (f: FlightState) => {
    onPick(f);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const showDropdown = open && q.length >= 2;

  return (
    <div className="search">
      <svg className="search__icon" viewBox="0 0 24 24" aria-hidden>
        <path d="M10.5 4a6.5 6.5 0 1 0 4.03 11.6l4.43 4.43 1.06-1.06-4.43-4.43A6.5 6.5 0 0 0 10.5 4Zm0 1.5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z" />
      </svg>
      <input
        ref={inputRef}
        className="search__input"
        placeholder="Search flight, registration or airport"
        value={query}
        autoFocus={autoFocus}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(results.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter' && results[active]) {
            pick(results[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
            inputRef.current?.blur();
            onClose?.();
          }
        }}
      />
      {!query && <kbd className="search__kbd">/</kbd>}
      {showDropdown && (
        <div className="search__results" role="listbox">
          {results.map((f, i) => (
            <button
              key={f.id}
              role="option"
              aria-selected={i === active}
              className={`search__result${i === active ? ' is-active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(f)}
            >
              <span className="dot" style={{ background: planeColor(f) }} />
              <span className="search__callsign">{f.callsign ?? f.reg ?? f.id.toUpperCase()}</span>
              <span className="search__sub">{[f.typeCode, f.reg].filter(Boolean).join(' · ')}</span>
              <span className="search__alt">{fmtAltitude(f.altFt, f.onGround)}</span>
            </button>
          ))}
          {results.length === 0 && (
            <div className="search__empty">{searching || q.length < 3 ? 'Searching…' : `No flights found for “${q}”`}</div>
          )}
        </div>
      )}
    </div>
  );
}
