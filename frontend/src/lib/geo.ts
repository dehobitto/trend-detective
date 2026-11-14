import { Vector3 } from 'three';
import type { BBox } from '../api/types';

/**
 * Lat/lon <-> scene coordinates for THREE.SphereGeometry with an equirectangular texture
 * (u = 0 at lon -180, v = 1 at the north pole). Verified against SphereGeometry vertices:
 *   x = cos(lat) cos(lon), y = sin(lat), z = -cos(lat) sin(lon)
 */
const RAD = Math.PI / 180;

export function latLonToVector3(lat: number, lon: number, radius = 1, out = new Vector3()): Vector3 {
  const la = lat * RAD;
  const lo = lon * RAD;
  return out.set(radius * Math.cos(la) * Math.cos(lo), radius * Math.sin(la), -radius * Math.cos(la) * Math.sin(lo));
}

export function vector3ToLatLon(v: Vector3): { lat: number; lon: number } {
  const n = v.clone().normalize();
  return { lat: Math.asin(n.y) / RAD, lon: Math.atan2(-n.z, n.x) / RAD };
}

/** Texture UV (from a raycast hit) -> lat/lon. */
export function uvToLatLon(u: number, v: number): { lat: number; lon: number } {
  return { lat: v * 180 - 90, lon: u * 360 - 180 };
}

export const clampLat = (lat: number) => Math.max(-85, Math.min(85, lat));
export const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

export function bboxCenter(b: BBox): { lat: number; lon: number } {
  return { lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 };
}

export function normalizeBBox(a: { lng: number; lat: number }, b: { lng: number; lat: number }): BBox {
  const r = (x: number) => Math.round(x * 100) / 100;
  return {
    west: r(Math.max(-180, Math.min(a.lng, b.lng))),
    east: r(Math.min(180, Math.max(a.lng, b.lng))),
    south: r(Math.max(-90, Math.min(a.lat, b.lat))),
    north: r(Math.min(90, Math.max(a.lat, b.lat))),
  };
}

export function bboxToPolygon(b: BBox): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [[[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north], [b.west, b.south]]],
    },
  };
}

export function isValidBBox(b: BBox): boolean {
  return b.west < b.east && b.south < b.north && b.west >= -180 && b.east <= 180 && b.south >= -90 && b.north <= 90;
}

export function formatLat(lat: number) {
  return `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}`;
}
export function formatLon(lon: number) {
  return `${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;
}
