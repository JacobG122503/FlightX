import type { SourceId } from '../../shared/types';
import type { FlightSource } from './types';
import { LiveSource } from './live';
import { SimSource } from './sim';

export const liveSource = new LiveSource();
export const simSource = new SimSource();

const sources: Record<SourceId, FlightSource> = {
  live: liveSource,
  sim: simSource,
};

export function getSource(id: unknown): FlightSource | null {
  const key = (typeof id === 'string' && id ? id : 'live') as SourceId;
  return sources[key] ?? null;
}
