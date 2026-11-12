import type { FlightListResponse, FlightState, SourceId } from '../../shared/types';
import { SearchBox } from './SearchBox';
import { fmtInt } from '../lib/format';
import { flightLiveStatus, liveStatus } from '../lib/liveStatus';
import { useNow } from '../hooks/useNow';

interface Props {
  source: SourceId;
  list: FlightListResponse | null;
  count: number;
  error: string | null;
  nextAt: number | null;
  /** Set when other planes are hidden: the status then describes this one aircraft. */
  focus?: FlightState | null;
  flights: FlightState[];
  onPick: (flight: FlightState) => void;
  onSource: (source: SourceId) => void;
}

export function TopBar({ source, list, count, error, nextAt, focus, flights, onPick, onSource }: Props) {
  const now = useNow(1000);
  const focused = focus !== undefined;
  const status = !error && focused ? flightLiveStatus(focus, now) : liveStatus(list, error, now, nextAt);

  return (
    <header className="topbar">
      <div className="topbar__brand glass">
        <svg viewBox="0 0 64 64" className="topbar__logo" aria-hidden>
          <path d="M32 6c2.2 0 3.6 2.4 3.6 5.4v13.2l20.4 12v5.2l-20.4-6.2v10.6l6 4.6v4.2L32 52l-9.6 3V50.8l6-4.6V35.6L8 41.8v-5.2l20.4-12V11.4C28.4 8.4 29.8 6 32 6z" />
        </svg>
        <span className="topbar__name">FlightX</span>
        <div className="mode-switch" role="tablist" aria-label="Mode">
          <button role="tab" aria-selected={source === 'live'} className={source === 'live' ? 'is-active' : ''} onClick={() => onSource('live')}>
            Real flights
          </button>
          <button role="tab" aria-selected={source === 'sim'} className={source === 'sim' ? 'is-active' : ''} onClick={() => onSource('sim')}>
            Simulate
          </button>
        </div>
      </div>

      <div className="topbar__search glass">
        <SearchBox flights={flights} source={source} onPick={onPick} />
      </div>

      <div className={`topbar__status glass is-${status.kind}`} title={status.tooltip} role="status" aria-live="polite">
        {status.kind !== 'sim' && (
        <span className={`status-badge is-${status.kind}`}>
          {status.kind === 'live' && <span className="live-dot" />}
          {status.kind === 'delayed' && (
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm.75-13h-1.5v5.6l4.8 2.9.75-1.23-4.05-2.42z" />
            </svg>
          )}
          {status.kind === 'offline' && <span className="offline-dot" />}
          {status.label}
        </span>
        )}
        {list && !error && !focused && (
          <span className="status-count">
            <strong>{fmtInt(count)}</strong> {source === 'sim' ? (count === 1 ? 'flight' : 'flights') : 'aircraft'}
          </span>
        )}
        {status.detail && <span className="status-detail">{status.detail}</span>}
        {status.hint && <span className="status-hint">{status.hint}</span>}
      </div>
    </header>
  );
}
