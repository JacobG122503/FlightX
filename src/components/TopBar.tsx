import type { FlightState } from '../../shared/types';
import { SearchBox } from './SearchBox';
import { fmtInt } from '../lib/format';

interface Props {
  /** Planes in view (null until the first load). */
  count: number | null;
  error: string | null;
  flights: FlightState[];
  onPick: (flight: FlightState) => void;
}

export function TopBar({ count, error, flights, onPick }: Props) {
  return (
    <header className="topbar">
      <div className="topbar__brand glass">
        <svg viewBox="0 0 64 64" className="topbar__logo" aria-hidden>
          <path d="M32 6c2.2 0 3.6 2.4 3.6 5.4v13.2l20.4 12v5.2l-20.4-6.2v10.6l6 4.6v4.2L32 52l-9.6 3V50.8l6-4.6V35.6L8 41.8v-5.2l20.4-12V11.4C28.4 8.4 29.8 6 32 6z" />
        </svg>
        <span className="topbar__name">FlightX</span>
      </div>

      <div className="topbar__search glass">
        <SearchBox flights={flights} onPick={onPick} />
      </div>

      <div className="topbar__status glass" role="status" aria-live="polite">
        {error ? (
          <span className="status-detail" title={error}>Simulator not responding — retrying…</span>
        ) : (
          count != null && (
            <span className="status-count">
              <strong>{fmtInt(count)}</strong> {count === 1 ? 'flight' : 'flights'}
            </span>
          )
        )}
      </div>
    </header>
  );
}
