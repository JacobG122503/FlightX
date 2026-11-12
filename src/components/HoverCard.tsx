import type { FlightState } from '../../shared/types';
import { fmtAltitude, fmtSpeed } from '../lib/format';
import { planeColor } from '../lib/icons';

export function HoverCard({ flight, x, y }: { flight: FlightState; x: number; y: number }) {
  return (
    <div className="hover-card" style={{ transform: `translate(${x + 16}px, ${y + 16}px)` }}>
      <div className="hover-card__title">
        <span className="dot" style={{ background: planeColor(flight) }} />
        {flight.callsign ?? flight.reg ?? flight.id.toUpperCase()}
        {flight.typeCode && <span className="hover-card__type">{flight.typeCode}</span>}
      </div>
      <div className="hover-card__meta">
        {fmtAltitude(flight.altFt, flight.onGround)} · {fmtSpeed(flight.gsKt)}
      </div>
    </div>
  );
}
