import type { Map as MlMap } from 'maplibre-gl';
import { globeConfig } from '../../config/globe';

/**
 * Shared bits of the globe <-> map hand-off, so the crossfade shows the same place at the same size:
 * - where the globe draws the point it looks at (the view is shifted for the docked case list / bottom prompt),
 * - which MapLibre zoom has the same scale as the globe camera at a given distance,
 * - where the globe is looking right now (the hidden map preloads tiles there).
 */

/**
 * Pixels the globe's look-at point sits away from the screen centre (+x right, +y down), for a camera at
 * `distance` (Earth radii). Wide screens, at rest: a big globe like an animated wallpaper, with about
 * `sideDock.visible` of its width showing at the right edge and the headline on the left. The shift fades
 * out as the camera comes down, so at the hand-off distance the place sits in the middle, like on the map.
 */
export function globeScreenOffset(width: number, height: number, distance: number = globeConfig.sideDock.distance): { dx: number; dy: number } {
  const docked = width >= globeConfig.sideDock.minWidth;
  const rest = docked ? globeConfig.sideDock.distance : globeConfig.defaultDistance;
  const k = Math.min(1, Math.max(0, (distance - globeConfig.arrivalDistance) / (rest - globeConfig.arrivalDistance)));
  const ease = k * k * (3 - 2 * k);
  if (!docked) {
    const lift = width < 760 ? 0.1 : globeConfig.verticalLift;
    return { dx: 0, dy: -height * lift * ease };
  }
  // On-screen radius of the globe at rest, then put its centre so `visible` of the width is on screen.
  const rPx = (height / 2) * (1 / Math.sqrt(rest * rest - 1)) / Math.tan(((globeConfig.fov / 2) * Math.PI) / 180);
  const centreX = width - rPx * (2 * globeConfig.sideDock.visible - 1);
  return { dx: Math.round((centreX - width / 2) * ease), dy: 0 };
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
  const { dx, dy } = globeScreenOffset(el.clientWidth, el.clientHeight, globeConfig.arrivalDistance);
  map.jumpTo({ center: [lon, lat], zoom });
  if (dx || dy) map.jumpTo({ center: map.unproject([el.clientWidth / 2 - dx, el.clientHeight / 2 - dy]) });
}

/** The place under the globe's look-at screen point on the map (what the globe should fly out from). */
export function mapPointLikeGlobe(map: MlMap): { lat: number; lon: number } {
  const el = map.getContainer();
  const { dx, dy } = globeScreenOffset(el.clientWidth, el.clientHeight, globeConfig.arrivalDistance);
  const p = map.unproject([el.clientWidth / 2 + dx, el.clientHeight / 2 + dy]);
  return { lat: p.lat, lon: p.lng };
}

/** Live state shared without React re-renders: updated every globe frame / by the map. */
export const handoff = {
  /** Where the globe camera looks (sub-camera point) and how far away it is. */
  look: { lat: 0, lon: 0, distance: 3 },
  /** The (possibly hidden) map, once created. */
  map: null as MlMap | null,
  /** True once the map has drawn the hand-off position at least once (its picture can be draped on the globe). */
  ready: false,
  /** True when the map has finished loading every tile there (the crossfade waits for this, briefly). */
  full: false,
};
