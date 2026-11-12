import type { FlightListResponse, FlightState } from '../../shared/types';
import { FEED_LABEL, fmtAgo } from './format';

/** Data newer than this (from a real-time feed) counts as LIVE. */
export const LIVE_MAX_AGE_MS = 30_000;

export type LiveStatusKind = 'connecting' | 'live' | 'delayed' | 'offline' | 'sim';

export interface LiveStatus {
  kind: LiveStatusKind;
  /** Badge text: "LIVE", "Updated 42s ago", "OFFLINE", … */
  label: string;
  /** Secondary text, e.g. "next update in 48s" or "last updated 3 min ago". */
  detail: string | null;
  /** Why it isn't live / how to get live, e.g. "Zoom in for live". */
  hint: string | null;
  /** Longer explanation for the tooltip. */
  tooltip: string;
}

const REALTIME_FEEDS = new Set(['adsbfi', 'adsblol', 'sim']);

function inSeconds(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

export function liveStatus(list: FlightListResponse | null, error: string | null, now: number, nextAt: number | null): LiveStatus {
  if (error) {
    return {
      kind: 'offline',
      label: 'OFFLINE',
      detail: list ? `Last updated ${fmtAgo(now - list.updatedAt)}` : 'Can’t reach the flight data service',
      hint: 'Retrying…',
      tooltip: `The flight data service didn’t respond (${error}). FlightX keeps retrying automatically.`,
    };
  }
  if (!list) {
    return { kind: 'connecting', label: 'Connecting…', detail: null, hint: null, tooltip: 'Loading flights…' };
  }

  if (list.feeds.includes('sim')) {
    return {
      kind: 'sim',
      label: 'SIMULATION',
      detail: 'real-time clock',
      hint: null,
      tooltip: 'Simulated flights moving in real time. They keep flying while FlightX is closed.',
    };
  }

  const age = now - list.updatedAt;
  const feeds = list.feeds.map((f) => FEED_LABEL[f] ?? f).join(' + ') || 'no feed';
  const realtime = list.mode === 'regional' && list.feeds.some((f) => REALTIME_FEEDS.has(f));

  if (realtime && age < LIVE_MAX_AGE_MS) {
    return {
      kind: 'live',
      label: 'LIVE',
      detail: feeds,
      hint: null,
      tooltip: `Real-time positions from ${feeds}, refreshed every few seconds.`,
    };
  }

  const next = nextAt != null && nextAt > now ? `next in ${inSeconds(nextAt - now)}` : 'updating…';
  const worldView = list.mode === 'global';
  return {
    kind: 'delayed',
    label: `Updated ${fmtAgo(age)}`,
    detail: next,
    hint: worldView ? 'Zoom in for live' : 'Live feed paused',
    tooltip: worldView
      ? `World view uses ${feeds}, which refreshes about every ${Math.round(list.refreshInMs / 1000)}s. Planes keep moving between updates by estimating from their speed and heading. Zoom in to switch to live data.`
      : `The real-time feeds are paused (rate limit or outage), so this view is using ${feeds}. Live data resumes automatically.`,
  };
}

/** Status of a single aircraft — used when other planes are hidden. */
export function flightLiveStatus(state: FlightState | null, now: number): LiveStatus {
  if (!state) return { kind: 'connecting', label: 'Connecting…', detail: null, hint: null, tooltip: 'Loading this flight…' };
  const age = now - state.ts;
  const feed = FEED_LABEL[state.feed] ?? state.feed;
  const name = state.callsign ?? state.reg ?? state.id.toUpperCase();
  if (state.feed === 'sim') {
    return { kind: 'sim', label: 'SIMULATION', detail: name, hint: null, tooltip: `${name}: simulated flight, moving in real time.` };
  }
  if (REALTIME_FEEDS.has(state.feed) && age < LIVE_MAX_AGE_MS) {
    return { kind: 'live', label: 'LIVE', detail: `${name} · ${feed}`, hint: null, tooltip: `${name}: real-time position from ${feed}.` };
  }
  return {
    kind: 'delayed',
    label: `Updated ${fmtAgo(age)}`,
    detail: `${name} · ${feed}`,
    hint: age > 120_000 ? 'Signal lost' : null,
    tooltip: `${name}’s last position report was ${fmtAgo(age)} (${feed}). Its position is estimated from speed and heading in between.`,
  };
}
