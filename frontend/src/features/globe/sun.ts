import { CanvasTexture, SRGBColorSpace, Vector2, Vector3 } from 'three';
import { create } from 'zustand';
import { latLonToVector3 } from '../../lib/geo';

/**
 * Shared uniforms for the globe shaders. Two lighting modes (CameraRig updates uSun every frame):
 * - live: the real Sun for the current moment, so the night side shows where it is night right now,
 *   lit by NASA Black Marble city lights (with faint moonlight so continents stay readable);
 * - studio: the sun follows the viewer, so the face you look at is always in daylight.
 * The cloud shift drifts the cloud layer and its shadows on the ground together.
 */
export const globeUniforms = {
  uSun: { value: new Vector3(0, 0, 1) },
  uCloudShift: { value: 0 },
  /** 1 = normal clouds; lowered while a data overlay is draped on the globe. */
  uCloudAlpha: { value: 1 },
  /** Faint light on the night side (live mode), so the dark hemisphere is not a black hole. */
  uMoon: { value: 0 },
  /**
   * Globe <-> map hand-off (0..1): the (hidden) map's own picture is draped on the globe where it lands and
   * clouds, grid, atmosphere and shading fade, so the crossfade swaps two images that already match.
   */
  uHandoff: { value: 0 },
  /** The map canvas as a texture, and where it looks: Web Mercator centre (0..1) and world size / canvas size. */
  uMapTex: { value: blankTexture() },
  uMapCenter: { value: new Vector2(0.5, 0.5) },
  uMapScale: { value: new Vector2(1, 1) },
};

function blankTexture() {
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (c) c.width = c.height = 2;
  const t = new CanvasTexture(c as HTMLCanvasElement);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const RAD = Math.PI / 180;

/** Sub-solar point (where the Sun is overhead) for a moment, in degrees. Accurate to a fraction of a degree. */
export function subsolarPoint(ms: number): { lat: number; lon: number } {
  const d = ms / 86_400_000 - 10957.5; // days since J2000.0 (2000-01-01 12:00 UTC)
  const g = (357.529 + 0.98560028 * d) * RAD; // mean anomaly
  const q = 280.459 + 0.98564736 * d; // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD; // ecliptic longitude
  const e = (23.439 - 0.00000036 * d) * RAD; // obliquity
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD;
  const dec = Math.asin(Math.sin(e) * Math.sin(L)) / RAD;
  const gmst = 280.46061837 + 360.98564736629 * d;
  const lon = ((((ra - gmst) % 360) + 540) % 360) - 180;
  return { lat: dec, lon };
}

/** Greenwich mean sidereal time in degrees (how far the stars have turned over the Earth). */
export function gmstDeg(ms: number): number {
  const d = ms / 86_400_000 - 10957.5;
  return (((280.46061837 + 360.98564736629 * d) % 360) + 360) % 360;
}

export function liveSunVector(ms: number, out: Vector3): Vector3 {
  const { lat, lon } = subsolarPoint(ms);
  return latLonToVector3(lat, lon, 1, out).normalize();
}

const KEY = 'td-live-sun';
function readLive(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

type SunState = {
  /** Real sunlight for the current moment (default) vs. studio light that follows the viewer. */
  live: boolean;
  setLive: (live: boolean) => void;
};

export const useSun = create<SunState>((set) => ({
  live: typeof window !== 'undefined' ? readLive() : true,
  setLive: (live) => {
    try {
      window.localStorage.setItem(KEY, live ? 'on' : 'off');
    } catch {
      /* not remembered */
    }
    set({ live });
  },
}));
