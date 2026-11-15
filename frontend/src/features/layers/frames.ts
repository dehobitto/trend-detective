import type { Colormap, GibsLayer, MapLayer } from '../../api/types';
import { mapConfig } from '../../config/map';

const GIBS_WMTS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

const parse = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Time-enabled GIBS WMTS tile URL template for one date (API.md v2). */
export function gibsTileUrl(l: GibsLayer, date: string): string {
  return `${GIBS_WMTS}/${l.layer}/default/${date}/${l.tile_matrix_set}/{z}/{y}/{x}.${l.format}`;
}

/** Snap a date to the start of its GIBS period. */
export function snapToStep(date: string, step: GibsLayer['time_step']): string {
  const d = parse(date);
  const y = d.getUTCFullYear();
  if (step === 'yearly') return `${y}-01-01`;
  if (step === 'monthly') return `${date.slice(0, 7)}-01`;
  if (step === '8day') {
    const doy = Math.floor((d.getTime() - Date.UTC(y, 0, 1)) / 86_400_000);
    return iso(new Date(Date.UTC(y, 0, 1 + Math.floor(doy / 8) * 8)));
  }
  return date.slice(0, 10);
}

function stepDates(start: string, end: string, step: GibsLayer['time_step']): string[] {
  const out: string[] = [];
  const e = parse(end);
  let d = parse(snapToStep(start, step));
  if (d < parse(start)) d = advance(d, step);
  for (let guard = 0; d <= e && guard < 20000; guard++) {
    out.push(iso(d));
    d = advance(d, step);
  }
  return out;
}

function advance(d: Date, step: GibsLayer['time_step']): Date {
  const n = new Date(d);
  if (step === 'yearly') n.setUTCFullYear(n.getUTCFullYear() + 1);
  else if (step === 'monthly') n.setUTCMonth(n.getUTCMonth() + 1);
  else if (step === 'daily') n.setUTCDate(n.getUTCDate() + 1);
  else {
    // 8-day periods restart on Jan 1 each year.
    const next = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 8));
    return next.getUTCFullYear() !== n.getUTCFullYear() ? new Date(Date.UTC(next.getUTCFullYear(), 0, 1)) : next;
  }
  return n;
}

/** Intersect [a0,a1] with [b0,b1]; if they don't overlap, fall back to [a0,a1] (what exists). */
function overlap(a0: string, a1: string, b0: string, b1: string): [string, string] {
  const s = a0 > b0 ? a0 : b0;
  const e = a1 < b1 ? a1 : b1;
  return s <= e ? [s, e] : [a0, a1];
}

/** Frames for the timeline: the layer's availability ∩ the investigation range. */
export function framesFor(layer: MapLayer, start: string, end: string, gridDates: string[] | null): string[] {
  if (layer.kind === 'gibs') {
    const [s, e] = overlap(layer.time_start, layer.time_end, start, end);
    let step = layer.time_step;
    // Daily layers: one frame a month keeps a 20-year slider usable (day = first available of that month).
    if (step === 'daily' && mapConfig.variableLayer.dailyFrameStep === 'monthly') {
      const day = String(mapConfig.variableLayer.dailyFrameDay).padStart(2, '0');
      return stepDates(s, e, 'monthly')
        .map((d) => `${d.slice(0, 8)}${day}`)
        .filter((d) => d >= s && d <= e);
    }
    return stepDates(s, e, step);
  }
  if (!gridDates?.length) return [];
  const inRange = gridDates.filter((d) => d >= start.slice(0, 7) + '-01' && d <= end);
  return inRange.length ? inRange : gridDates;
}

/** Index of the frame closest to `date` (frames are sorted). */
export function nearestFrame(frames: string[], date: string | null): number {
  if (!frames.length) return -1;
  if (!date) return frames.length - 1;
  let best = 0;
  const t = parse(date).getTime();
  for (let i = 0; i < frames.length; i++) {
    if (Math.abs(parse(frames[i]).getTime() - t) < Math.abs(parse(frames[best]).getTime() - t)) best = i;
  }
  return best;
}

export function formatFrame(date: string, step: GibsLayer['time_step'] | 'monthly'): string {
  const d = parse(date);
  if (step === 'yearly') return String(d.getUTCFullYear());
  if (step === 'monthly') return d.toLocaleDateString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return d.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/* ------------------------------------------------------------------ colour */

function hexToRgb(h: string): [number, number, number] {
  const x = h.replace('#', '');
  const f = x.length === 3 ? x.split('').map((c) => c + c).join('') : x.slice(0, 6);
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
}

/** 256-entry RGB lookup table spanning [min, max]. */
export function buildLut(cmap: Colormap, min: number, max: number): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  const stops = [...cmap.stops].sort((a, b) => a[0] - b[0]).map(([v, c]) => [v, hexToRgb(c)] as const);
  for (let i = 0; i < 256; i++) {
    const v = min + ((max - min) * i) / 255;
    let k = 0;
    while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
    const [v0, c0] = stops[k];
    const [v1, c1] = stops[Math.min(k + 1, stops.length - 1)];
    const t = v1 === v0 ? 0 : Math.max(0, Math.min(1, (v - v0) / (v1 - v0)));
    for (let j = 0; j < 3; j++) lut[i * 3 + j] = c0[j] + (c1[j] - c0[j]) * t;
  }
  return lut;
}

/** CSS gradient for a colormap legend. */
export function cssGradient(cmap: Colormap, min: number, max: number): string {
  const span = max - min || 1;
  const parts = [...cmap.stops]
    .sort((a, b) => a[0] - b[0])
    .map(([v, c]) => `${c} ${Math.max(0, Math.min(100, ((v - min) / span) * 100)).toFixed(1)}%`);
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}
