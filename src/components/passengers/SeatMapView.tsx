import { useState } from 'react';
import type { SeatMap } from '../../../shared/sim';

interface Props {
  map: SeatMap;
  /** Extra class for a seat: 'is-taken', 'is-custom', 'is-selected'… */
  seatClass: (seat: string) => string;
  onSeat?: (seat: string) => void;
  title?: (seat: string) => string | undefined;
}

/** Top-down cabin view: one row per seat row, aisles as gaps, one tab per deck. */
export function SeatMapView({ map, seatClass, onSeat, title }: Props) {
  const [deck, setDeck] = useState(0);
  const current = map.decks[Math.min(deck, map.decks.length - 1)];
  return (
    <div className="seatmap">
      {map.decks.length > 1 && (
        <div className="seatmap__decks">
          {map.decks.map((d, i) => (
            <button key={d.name} className={i === deck ? 'is-active' : ''} onClick={() => setDeck(i)}>
              {d.name} deck
            </button>
          ))}
        </div>
      )}
      <div className="seatmap__fuselage">
        {current.cabins.map((cabin, ci) => {
          const groups = cabin.layout.split('-');
          return (
            <div key={ci} className={`seatmap__cabin seatmap__cabin--${cabin.code}`}>
              <div className="seatmap__cabin-name">
                {cabin.name} <span>{groups.map((g) => g.length).join('-')}</span>
              </div>
              {cabin.rows.map((row) => (
                <div key={row} className="seatmap__row">
                  <span className="seatmap__rownum">{row}</span>
                  {groups.map((g, gi) => (
                    <span key={gi} className="seatmap__group">
                      {[...g].map((letter) => {
                        const seat = `${row}${letter}`;
                        return (
                          <button
                            key={seat}
                            className={`seat ${seatClass(seat)}`}
                            title={title?.(seat) ?? seat}
                            onClick={onSeat ? () => onSeat(seat) : undefined}
                          >
                            {letter}
                          </button>
                        );
                      })}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
