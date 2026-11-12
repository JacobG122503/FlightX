import type { FlightDetailResponse, FlightState } from '../../shared/types';
import { extrapolate, haversineKm, KM_PER_NM } from '../../shared/geo';
import { useNow } from '../hooks/useNow';
import { fmtAltitude, fmtSpeed } from '../lib/format';
import { fmtMinutes, timeTz } from '../lib/time';

interface Props {
  state: FlightState;
  detail: FlightDetailResponse | null;
}

/** The only thing on screen in chill mode: the followed flight and how long until it lands. */
export function ChillHud({ state, detail }: Props) {
  const now = useNow(1000);
  const sim = detail?.sim ?? null;
  const route = detail?.route ?? null;
  const name = state.callsign ?? state.reg ?? state.id.toUpperCase();

  let from: string | null = null;
  let to: string | null = null;
  let landAt: number | null = null;
  let progress: number | null = null;

  if (sim) {
    from = sim.origin.iata;
    to = sim.destination.iata;
    landAt = sim.landAt;
    progress = Math.min(1, Math.max(0, (now - sim.takeoffAt) / (sim.landAt - sim.takeoffAt)));
  } else if (route?.plausible) {
    from = route.origin.iata ?? route.origin.icao;
    to = route.destination.iata ?? route.destination.icao;
    const pos = extrapolate(state, now);
    const flown = haversineKm(route.origin, pos);
    const left = haversineKm(pos, route.destination);
    progress = flown / Math.max(1, flown + left);
    if (state.gsKt && state.gsKt > 60 && !state.onGround) landAt = now + (left / (state.gsKt * KM_PER_NM)) * 3_600_000;
  }

  const minutesLeft = landAt != null ? Math.max(0, (landAt - now) / 60_000) : null;

  return (
    <div className="chill-hud glass" aria-live="polite">
      <div className="chill-hud__top">
        <span className="chill-hud__name">{name}</span>
        {from && to && (
          <span className="chill-hud__route">
            {from} → {to}
            {sim?.nextLeg && <span className="muted"> · then {sim.finalDestination.iata}</span>}
          </span>
        )}
      </div>
      <div className="chill-hud__eta">
        {state.onGround && minutesLeft === 0
          ? 'Arrived'
          : minutesLeft != null
            ? `Lands in ${fmtMinutes(minutesLeft)}`
            : 'Cruising'}
        {landAt != null && minutesLeft !== 0 && <span className="chill-hud__at"> · {timeTz(landAt)}</span>}
      </div>
      {progress != null && (
        <div className="chill-hud__bar">
          <div style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      <div className="chill-hud__stats">
        <span>{fmtAltitude(state.altFt, state.onGround)}</span>
        <span>{fmtSpeed(state.gsKt)}</span>
      </div>
    </div>
  );
}
