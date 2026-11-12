import { useControl } from 'react-map-gl/maplibre';
import { MapboxOverlay, type MapboxOverlayProps } from '@deck.gl/mapbox';
import type { IControl } from 'maplibre-gl';

/**
 * Mounts a deck.gl WebGL overlay on the MapLibre map (must be a child of <Map>).
 * Renders thousands of aircraft smoothly.
 */
export function DeckOverlay(props: MapboxOverlayProps) {
  const overlay = useControl(() => new MapboxOverlay({ ...props, interleaved: false }) as unknown as IControl) as unknown as MapboxOverlay;
  overlay.setProps(props);
  return null;
}
