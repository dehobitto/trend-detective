import type { Map as MlMap } from 'maplibre-gl';
import { globeConfig } from '../../config/globe';

/**
 * Shared bits of the globe <-> map hand-off, so the crossfade shows the same place at the same size:
 * - where the globe draws the point it looks at (the view is shifted for the docked case list / bottom prompt),
 * - which MapLibre zoom has the same scale as the globe camera at a given distance,
 * - where the globe is looking right now (the hidden map preloads tiles there).
 */

/** Pixels the globe's look-at point sits away from the screen centre (+x right, +y down). */
export function globeScreenOffset(width: number, height: number): { dx: number; dy: number } {
  const docked = width >= globeConfig.sideDock.minWidth;
  const lift = width < 760 ? 0.1 : docked ? 0 : globeConfig.verticalLift;
  // Wide screens: the headline takes the left, the globe sits right of centre (and may run off the edge).
  return { dx: docked ? Math.round(width * globeConfig.sideDock.shiftFrac) : 0, dy: -height * lift };
}

/**
 * MapLibre zoom with the same scale, at the screen centre, as the globe camera at `distance` (Earth radii
 * from the centre). Globe: px per radian = H / (2·tan(fov/2)·(d−1)). Web Mercator at latitude φ:
 * px per radian of latitude = 512·2^z / (2π) / cos φ.
 */
export function matchedZoom(lat: number, distance: number, height: number): number {
  const pxPerRad = height / (2 * Math.tan(((globeConfig.fov / 2) * Math.PI) / 180) * Math.max(0.02, distance - 1));
  const z = Math.log2((pxPerRad * 2 * Math.PI * Math.cos((lat * Math.PI) / 180)) / 512);
  return Math.max(1, Math.min(12, z));
}

/** Inverse of matchedZoom: the globe camera distance with the map's scale at `zoom`. */
export function distanceForZoom(lat: number, zoom: number, height: number): number {
  const pxPerRad = (512 * Math.pow(2, zoom)) / (2 * Math.PI * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return 1 + height / (2 * Math.tan(((globeConfig.fov / 2) * Math.PI) / 180) * pxPerRad);
}

/** Put `lat/lon` on the map at the globe's look-at screen point, at `zoom`. */
export function placeLikeGlobe(map: MlMap, lat: number, lon: number, zoom: number) {
  const el = map.getContainer();
  const { dx, dy } = globeScreenOffset(el.clientWidth, el.clientHeight);
  map.jumpTo({ center: [lon, lat], zoom });
  if (dx || dy) map.jumpTo({ center: map.unproject([el.clientWidth / 2 - dx, el.clientHeight / 2 - dy]) });
}

/** The place under the globe's look-at screen point on the map (what the globe should fly out from). */
export function mapPointLikeGlobe(map: MlMap): { lat: number; lon: number } {
  const el = map.getContainer();
  const { dx, dy } = globeScreenOffset(el.clientWidth, el.clientHeight);
  const p = map.unproject([el.clientWidth / 2 + dx, el.clientHeight / 2 + dy]);
  return { lat: p.lat, lon: p.lng };
}

/** Live state shared without React re-renders: updated every globe frame / by the map. */
export const handoff = {
  /** Where the globe camera looks (sub-camera point) and how far away it is. */
  look: { lat: 0, lon: 0, distance: 3 },
  /** The (possibly hidden) map, once created. */
  map: null as MlMap | null,
  /** True when the map has finished loading the tiles for the hand-off position. */
  ready: false,
};
