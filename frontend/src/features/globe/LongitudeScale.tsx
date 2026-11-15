import { useFrame, useThree } from '@react-three/fiber';
import { useRef, type RefObject } from 'react';
import { PerspectiveCamera, Vector3 } from 'three';
import { vector3ToLatLon } from '../../lib/geo';

const TICK_DEG = 10;
const LABEL_DEG = 30;
const GAP_PX = 26; // space between the globe's edge and the scale

const lonLabel = (l: number) => {
  const w = ((((l + 180) % 360) + 360) % 360) - 180;
  if (Math.abs(w) < 1e-6 || Math.abs(Math.abs(w) - 180) < 1e-6) return `${Math.abs(w)}°`;
  return `${Math.abs(w)}°${w > 0 ? 'E' : 'W'}`;
};
const latText = (lat: number) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}`;
const lonText = (lon: number) => `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;

const tmp = new Vector3();

/**
 * Longitude scale under the globe: the meridians of the facing hemisphere at their orthographic
 * positions (x = r·sin Δλ, so they crowd towards the limb like on the sphere), with the point
 * the camera looks at marked and read out. Written straight to the DOM from the render loop.
 */
export function LongitudeScale({ target }: { target: RefObject<HTMLDivElement | null> }) {
  const { camera, size } = useThree();
  const last = useRef('');

  useFrame(() => {
    const el = target.current;
    if (!el) return;
    const cam = camera as PerspectiveCamera;
    const d = cam.position.length();
    // Screen centre and apparent radius of the unit sphere.
    tmp.set(0, 0, 0).project(cam);
    const cx = (tmp.x * 0.5 + 0.5) * size.width;
    const cy = (-tmp.y * 0.5 + 0.5) * size.height;
    const r = (Math.tan(Math.asin(1 / d)) / Math.tan(((cam.fov / 2) * Math.PI) / 180)) * (size.height / 2);
    const { lat, lon } = vector3ToLatLon(cam.position);
    const y = cy + r + GAP_PX;
    const fits = y + 40 < size.height && r > 120 && d > 2;
    const key = `${fits}|${cx.toFixed(1)}|${y.toFixed(1)}|${r.toFixed(1)}|${lon.toFixed(2)}|${lat.toFixed(1)}`;
    if (key === last.current) return;
    last.current = key;
    if (!fits) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    let ticks = '';
    let labels = '';
    const first = Math.ceil((lon - 90) / TICK_DEG) * TICK_DEG;
    for (let L = first; L <= lon + 90; L += TICK_DEG) {
      const dl = ((L - lon) * Math.PI) / 180;
      if (Math.cos(dl) <= 0.02) continue;
      const x = r * Math.sin(dl);
      const major = L % LABEL_DEG === 0;
      ticks += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="0" y2="${major ? 7 : 4}"/>`;
      // Labels only where the spacing allows (not right at the limb).
      if (major && Math.cos(dl) > 0.35) labels += `<text x="${x.toFixed(1)}" y="20">${lonLabel(L)}</text>`;
    }
    el.style.transform = `translate(${cx.toFixed(1)}px, ${y.toFixed(1)}px)`;
    el.innerHTML =
      `<svg class="lon-scale__svg" width="${(2 * r + 2).toFixed(0)}" height="44" viewBox="${(-r - 1).toFixed(1)} -1 ${(2 * r + 2).toFixed(1)} 44" aria-hidden="true">` +
      `<line class="lon-scale__base" x1="${-r}" x2="${r}" y1="0" y2="0"/>${ticks}${labels}` +
      `<path class="lon-scale__mark" d="M0 -1 L-4.5 -8 L4.5 -8 Z"/>` +
      `</svg><span class="lon-scale__readout">${latText(lat)} ${lonText(lon)}</span>`;
  });

  return null;
}
