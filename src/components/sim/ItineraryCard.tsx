import type { ItineraryOption } from '../../../shared/sim';
import type { SimAirport } from '../../../shared/sim';
import { airportTimeTip, dayOffset, fmtMinutes, timeTz } from '../../lib/time';

const place = (a: SimAirport) => a.city?.split(',')[0] ?? a.iata;
const airportTip = (a: SimAirport) => `${a.name}${a.city ? ` — ${a.city.split(',')[0]}` : ''}`;

const TAG_LABEL = { best: 'Best match', cheapest: 'Cheapest', fastest: 'Fastest' } as const;

interface Props {
  option: ItineraryOption;
  busy: boolean;
  onFly: () => void;
  customCount: number;
  onPassengers: () => void;
}

/** One result, laid out like a flight-booking site. */
export function ItineraryCard({ option: o, busy, onFly, customCount, onPassengers }: Props) {
  const first = o.legs[0];
  const last = o.legs[o.legs.length - 1];
  const plusDays = dayOffset(o.departAt, null, o.arriveAt, null);
  const airlines = [...new Set(o.legs.map((l) => (l.operatedBy ? `${l.airline.name} (${l.operatedBy})` : l.airline.name)))].join(' + ');
  const aircraft = [...new Set(o.legs.map((l) => l.aircraftName.replace(/^(Boeing|Airbus|Embraer|Bombardier) /, '')))].join(', ');
  const best = o.tags.includes('best');

  return (
    <div className={`itin${best ? ' is-best' : ''}${o.kind === 'charter' ? ' is-private' : ''}`}>
      {(o.tags.length > 0 || o.kind === 'charter') && (
        <div className="itin__tags">
          {o.tags.map((t) => (
            <span key={t} className={`itin__tag itin__tag--${t}`}>
              {TAG_LABEL[t]}
            </span>
          ))}
          {o.kind === 'charter' && <span className="itin__tag itin__tag--private">{o.aircraftCount > 1 ? `Charter · ${o.aircraftCount} planes` : 'Charter'}</span>}
        </div>
      )}
      <div className="itin__times">
        <div>
          <div className="itin__time" data-tip={airportTimeTip(o.departAt, first.from.tz, place(first.from))}>
            {timeTz(o.departAt)}
          </div>
          <div className="itin__code">
            <span className="code" data-tip={airportTip(first.from)}>{first.from.iata}</span>
          </div>
        </div>
        <div className="itin__mid">
          <div className="itin__duration">{fmtMinutes(o.durationMin)}</div>
          <div className="itin__line">
            {o.layovers.map((_, i) => (
              <span key={i} className="itin__stopdot" style={{ left: `${((i + 1) / (o.layovers.length + 1)) * 100}%` }} />
            ))}
          </div>
          <div className={`itin__stops${o.stops === 0 ? ' is-nonstop' : ''}`}>
            {o.stops === 0
              ? 'Nonstop'
              : o.layovers.map((l, i) => (
                  <span key={i}>
                    {i > 0 && ' · '}
                    <span className="code" data-tip={airportTip(l.airport)}>{l.airport.iata}</span> {fmtMinutes(l.minutes)}
                    {l.fuelStop ? ' (fuel)' : ''}
                  </span>
                ))}
          </div>
        </div>
        <div className="itin__end">
          <div className="itin__time" data-tip={airportTimeTip(o.arriveAt, last.to.tz, place(last.to))}>
            {timeTz(o.arriveAt)}
            {plusDays > 0 && <sup>+{plusDays}</sup>}
          </div>
          <div className="itin__code">
            <span className="code" data-tip={airportTip(last.to)}>{last.to.iata}</span>
          </div>
        </div>
      </div>
      <div className="itin__meta">
        <span className="itin__airline">{airlines}</span>
        <span className="itin__aircraft">{aircraft}</span>
      </div>
      {o.note && <div className="itin__note">{o.note}</div>}
      <div className="itin__foot">
        <button className="itin__pax" onClick={onPassengers} title="Add your own passengers and choose seats">
          {customCount ? `${customCount} named` : 'Add passengers'}
        </button>
        <span className="itin__flights">{o.kind === 'charter' ? '' : o.legs.map((l) => l.flightNumber).join(' · ')}</span>
        <span className="itin__price" title={o.passengers > 1 ? `$${Math.round(o.priceUsd / o.passengers).toLocaleString()} per person` : undefined}>
          ${o.priceUsd.toLocaleString()}
          {o.passengers > 1 && <small> total</small>}
        </span>
        <button className="itin__fly" onClick={onFly} disabled={busy}>
          Fly this
        </button>
      </div>
    </div>
  );
}
