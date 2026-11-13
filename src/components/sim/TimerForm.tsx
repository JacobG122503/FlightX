import { useState, type FormEvent } from 'react';
import type { TimerResponse } from '../../../shared/sim';
import { api } from '../../api';

interface Props {
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onSent: (res: TimerResponse) => void;
  onError: (message: string) => void;
}

const clampInt = (v: string, max: number) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));

/** Timer flight: pick a length of time and send a random flight that ends right when it's up. */
export function TimerForm({ busy, setBusy, onSent, onError }: Props) {
  const [hours, setHours] = useState(1);
  const [minutes, setMinutes] = useState(0);
  const total = hours * 60 + minutes;

  const start = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || total < 1) return;
    setBusy(true);
    try {
      onSent(await api.sim.timer(total));
      setHours(1);
      setMinutes(0);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="timer-form" onSubmit={start}>
      <div className="timer-form__row">
        <label className="timer-field">
          <input type="number" min={0} max={72} value={hours} onChange={(e) => setHours(clampInt(e.target.value, 72))} aria-label="Hours" />
          <span>h</span>
        </label>
        <label className="timer-field">
          <input type="number" min={0} max={59} value={minutes} onChange={(e) => setMinutes(clampInt(e.target.value, 59))} aria-label="Minutes" />
          <span>m</span>
        </label>
        <button className="btn btn--primary timer-form__go" type="submit" disabled={busy || total < 1}>
          Send
        </button>
      </div>
      <p className="muted timer-form__hint">Sends a random flight that parks at its gate exactly this long from now.</p>
    </form>
  );
}
