import type { ImageSource, Map as MlMap } from 'maplibre-gl';
import { useEffect } from 'react';
import { api } from '../../api/client';
import type { BBox, GridFrame } from '../../api/types';
import { mapConfig } from '../../config/map';
import { neighbourFrames } from '../layers/frames';
import { paintGrid } from '../layers/gridRender';
import { useLayers, usesGrid, type MapMode } from '../layers/layerStore';
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

/** Paint a GridFrame onto a canvas in Web-Mercator rows (so the image source lines up with the map). */
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
  paintGrid(f, canvas, W, H, (y) => latOf(y0 - (y / H) * (y0 - y1)));
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
/** `date` is the month (value/anomaly) or "start/end" (trend). */
function fetchFrame(variableId: string, mode: MapMode, date: string, q: Query): Promise<GridFrame> {
  const key = `${variableId}|${mode}|${date}|${q.key}`;
  let p = cache.get(key);
  if (p) {
    cache.delete(key);
    cache.set(key, p); // refresh recency
    return p;
  }
  if (mode === 'trend') {
    const [start, end] = date.split('/');
    // A trend is one heavier map: ask for a coarser grid than a single frame.
    const res = Math.max(q.res, (q.bbox.east - q.bbox.west) / cfg.trendCells);
    p = api.getTrendGrid(variableId, { start, end, bbox: q.bbox, res: Math.round(res * 1e4) / 1e4 });
  } else p = api.getGrid(variableId, { date, bbox: q.bbox, res: q.res, mode });
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
      useLayers.getState().set({ gridLegend: { min: f.min, max: f.max, units: f.units, colormap: f.colormap, synthetic: f.synthetic, diverging: f.min < 0 && f.max > 0 && Math.abs(f.min + f.max) < 1e-9 } });
    };

    const sync = (moved = false) => {
      const s = useLayers.getState();
      const trend = s.mode === 'trend';
      if (!usesGrid(s) || !s.variableId || (trend ? !s.trendPeriod : !s.date)) {
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
      const { variableId, frames, mode } = s;
      const date = trend ? `${s.trendPeriod!.start}/${s.trendPeriod!.end}` : s.date!;
      const q = query;
      s.set({ loading: true });
      fetchFrame(variableId, mode, date, q)
        .then((f) => {
          if (my !== seq) return;
          paint(f);
          useLayers.getState().set({ loading: false, overlayError: null });
          // Preload the frames around this one (both directions) for stepping and playback.
          if (!trend) for (const d of neighbourFrames(frames, date, cfg.gridPrefetch, 2)) fetchFrame(variableId, mode, d, q).catch(() => {});
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
      } else if (s.mode !== p.mode || s.trendPeriod?.start !== p.trendPeriod?.start || s.trendPeriod?.end !== p.trendPeriod?.end || (s.date !== p.date && s.mode !== 'trend')) sync();
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
