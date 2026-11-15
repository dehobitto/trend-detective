import type { ImageSource, Map as MlMap } from 'maplibre-gl';
import { useEffect } from 'react';
import { api } from '../../api/client';
import type { BBox, GridFrame } from '../../api/types';
import { mapConfig } from '../../config/map';
import { buildLut } from '../layers/frames';
import { useLayers } from '../layers/layerStore';
import { OVERLAY_BEFORE } from './layers';

const SRC = 'vgrid';
const MAX_LAT = 85.0511;
const cfg = mapConfig.variableLayer;

type Query = { bbox: BBox; res: number; key: string };

/** Grid query for the current view: the visible area plus a margin, snapped so small pans reuse frames. */
function queryFor(map: MlMap): Query {
  const b = map.getBounds();
  let w = b.getWest();
  let e = b.getEast();
  let s = b.getSouth();
  let n = b.getNorth();
  const span = Math.max(e - w, n - s);
  const snap = 2 ** Math.ceil(Math.log2(Math.max(span / 3, 0.05)));
  const margin = span * 0.25;
  w = Math.max(-180, Math.floor((w - margin) / snap) * snap);
  e = Math.min(180, Math.ceil((e + margin) / snap) * snap);
  s = Math.max(-MAX_LAT, Math.floor((s - margin) / snap) * snap);
  n = Math.min(MAX_LAT, Math.ceil((n + margin) / snap) * snap);
  if (e - w >= 359) {
    w = -180;
    e = 180;
  }
  const res = Math.max((e - w) / cfg.gridCells, (n - s) / cfg.gridCells, 0.01);
  const r = (x: number) => Math.round(x * 1e4) / 1e4;
  const bbox = { west: r(w), south: r(s), east: r(e), north: r(n) };
  return { bbox, res: r(res), key: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}@${r(res)}` };
}

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const latOf = (y: number) => (Math.atan(Math.sinh(y)) * 180) / Math.PI;

/**
 * Paint a GridFrame onto a canvas in Web-Mercator rows (so the image source lines up with the map),
 * bilinear-interpolating values and leaving no-data cells transparent.
 */
function renderFrame(f: GridFrame, canvas: HTMLCanvasElement): { coords: [[number, number], [number, number], [number, number], [number, number]] } {
  const north = Math.min(MAX_LAT, f.bbox.north);
  const south = Math.max(-MAX_LAT, f.bbox.south);
  const spanX = ((f.bbox.east - f.bbox.west) * Math.PI) / 180;
  const y0 = mercY(north);
  const y1 = mercY(south);
  const aspect = (y0 - y1) / spanX;
  const long = Math.min(cfg.gridCanvasPx, Math.max(f.width, f.height) * 4);
  const W = Math.max(2, Math.round(aspect > 1 ? long / aspect : long));
  const H = Math.max(2, Math.round(aspect > 1 ? long : long * aspect));
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const px = img.data;
  const lut = buildLut(f.colormap, f.min, f.max);
  const { width: gw, height: gh, values } = f;
  const latSpan = f.bbox.north - f.bbox.south;
  const scale = 255 / (f.max - f.min || 1);

  // Column sample positions are the same for every row.
  const c0 = new Int32Array(W);
  const c1 = new Int32Array(W);
  const cx = new Float32Array(W);
  for (let i = 0; i < W; i++) {
    const fc = Math.max(0, Math.min(gw - 1, ((i + 0.5) / W) * gw - 0.5));
    c0[i] = Math.floor(fc);
    c1[i] = Math.min(gw - 1, c0[i] + 1);
    cx[i] = fc - c0[i];
  }
  for (let j = 0; j < H; j++) {
    const lat = latOf(y0 - ((j + 0.5) / H) * (y0 - y1));
    const fr = Math.max(0, Math.min(gh - 1, ((f.bbox.north - lat) / latSpan) * gh - 0.5));
    const r0 = Math.floor(fr);
    const r1 = Math.min(gh - 1, r0 + 1);
    const ty = fr - r0;
    for (let i = 0; i < W; i++) {
      const tx = cx[i];
      const v00 = values[r0 * gw + c0[i]];
      const v01 = values[r0 * gw + c1[i]];
      const v10 = values[r1 * gw + c0[i]];
      const v11 = values[r1 * gw + c1[i]];
      let sum = 0;
      let wsum = 0;
      const add = (v: number | null, w: number) => {
        if (v !== null && v !== undefined && Number.isFinite(v)) {
          sum += v * w;
          wsum += w;
        }
      };
      add(v00, (1 - tx) * (1 - ty));
      add(v01, tx * (1 - ty));
      add(v10, (1 - tx) * ty);
      add(v11, tx * ty);
      const o = (j * W + i) * 4;
      if (wsum < 0.5) {
        px[o + 3] = 0;
        continue;
      }
      const k = Math.max(0, Math.min(255, Math.round((sum / wsum - f.min) * scale))) * 3;
      px[o] = lut[k];
      px[o + 1] = lut[k + 1];
      px[o + 2] = lut[k + 2];
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const { west, east } = f.bbox;
  return {
    coords: [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ],
  };
}

/** LRU-ish cache of frame fetches, shared across renders. */
const cache = new Map<string, Promise<GridFrame>>();
function fetchFrame(variableId: string, date: string, q: Query): Promise<GridFrame> {
  const key = `${variableId}|${date}|${q.key}`;
  let p = cache.get(key);
  if (p) {
    cache.delete(key);
    cache.set(key, p); // refresh recency
    return p;
  }
  p = api.getGrid(variableId, { date, bbox: q.bbox, res: q.res });
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  while (cache.size > cfg.gridCacheSize) cache.delete(cache.keys().next().value!);
  return p;
}

/**
 * Gridded variable values (GET /api/grid) as a colour-mapped heatmap overlay.
 * Fetches the visible area, prefetches the next frames, renders client-side.
 */
export function useGridOverlay(map: MlMap | null) {
  useEffect(() => {
    if (!map) return;
    const canvas = document.createElement('canvas');
    let query: Query | null = null;
    let seq = 0;

    const remove = () => {
      if (map.getLayer(SRC)) map.removeLayer(SRC);
      if (map.getSource(SRC)) map.removeSource(SRC);
    };

    const paint = (f: GridFrame) => {
      const { coords } = renderFrame(f, canvas);
      const url = canvas.toDataURL('image/png');
      const { opacity, overlayOn } = useLayers.getState();
      const src = map.getSource(SRC) as ImageSource | undefined;
      if (src) src.updateImage({ url, coordinates: coords });
      else {
        map.addSource(SRC, { type: 'image', url, coordinates: coords });
        map.addLayer({ id: SRC, type: 'raster', source: SRC, paint: { 'raster-opacity': overlayOn ? opacity : 0, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, OVERLAY_BEFORE);
      }
      useLayers.getState().set({ gridLegend: { min: f.min, max: f.max, units: f.units, colormap: f.colormap, synthetic: f.synthetic } });
    };

    const sync = (moved = false) => {
      const s = useLayers.getState();
      if (s.layer?.kind !== 'grid' || !s.variableId || !s.date) {
        remove();
        query = null;
        return;
      }
      if (moved || !query) {
        const q = queryFor(map);
        if (moved && q.key === query?.key) return; // same snapped area: nothing to refetch
        query = q;
      }
      const my = ++seq;
      const { variableId, date, frames } = s;
      const q = query;
      s.set({ loading: true });
      fetchFrame(variableId, date, q)
        .then((f) => {
          if (my !== seq) return;
          paint(f);
          useLayers.getState().set({ loading: false, overlayError: null });
          // Prefetch the next frames for smooth playback.
          const i = frames.indexOf(date);
          for (let k = 1; k <= cfg.gridPrefetch && i >= 0; k++) {
            const next = frames[(i + k) % frames.length];
            if (next) fetchFrame(variableId, next, q).catch(() => {});
          }
        })
        .catch((e) => {
          if (my !== seq) return;
          useLayers.getState().set({ loading: false, overlayError: `Could not load the map layer: ${e instanceof Error ? e.message : 'error'}` });
        });
    };

    const onMoveEnd = () => sync(true);
    sync();
    map.on('moveend', onMoveEnd);
    const unsub = useLayers.subscribe((s, p) => {
      if (s.layer !== p.layer || s.variableId !== p.variableId) {
        query = null;
        sync();
      } else if (s.date !== p.date) sync();
      else if ((s.opacity !== p.opacity || s.overlayOn !== p.overlayOn) && map.getLayer(SRC)) {
        map.setPaintProperty(SRC, 'raster-opacity', s.overlayOn ? s.opacity : 0);
      }
    });
    return () => {
      unsub();
      map.off('moveend', onMoveEnd);
      if (map.getStyle()) remove();
    };
  }, [map]);
}
