import { Vector3 } from 'three';
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
};

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
  /** Time-lapse offset added to "now" (ms); the "Spin a day" button runs it through 24 hours. */
  offsetMs: number;
  spinning: boolean;
  setLive: (live: boolean) => void;
  spinDay: () => void;
};

export const useSun = create<SunState>((set, get) => ({
  live: typeof window !== 'undefined' ? readLive() : true,
  offsetMs: 0,
  spinning: false,
  setLive: (live) => {
    try {
      window.localStorage.setItem(KEY, live ? 'on' : 'off');
    } catch {
      /* not remembered */
    }
    set({ live, offsetMs: 0, spinning: false });
  },
  spinDay: () => {
    if (get().spinning) return;
    set({ live: true, spinning: true, offsetMs: 0 });
    const t0 = performance.now();
    const DUR = 9000;
    const step = (now: number) => {
      if (!get().spinning) return;
      const k = Math.min(1, (now - t0) / DUR);
      const eased = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      set({ offsetMs: eased * 86_400_000 });
      if (k < 1) requestAnimationFrame(step);
      else set({ spinning: false, offsetMs: 0 });
    };
    requestAnimationFrame(step);
  },
}));
