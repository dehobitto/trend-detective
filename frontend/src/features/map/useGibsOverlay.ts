import type { Map as MlMap } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import type { GibsLayer } from '../../api/types';
import { mapConfig } from '../../config/map';
import { gibsTileUrl, neighbourFrames } from '../layers/frames';
import { useLayers } from '../layers/layerStore';
import { OVERLAY_BEFORE } from './layers';

const PREFIX = 'vgibs-';

/**
 * Does GIBS have an image for this date? MapLibre stays silent about 404 raster tiles, so probe the
 * single z0 tile (cheap, cached by the browser and here). Gap months (e.g. GRACE 2017–18) answer 404.
 */
const probes = new Map<string, Promise<boolean>>();
export function hasImagery(l: GibsLayer, date: string): Promise<boolean> {
  const url = gibsTileUrl(l, date).replace('{z}/{y}/{x}', '0/0/0');
  let p = probes.get(url);
  if (!p) {
    p = fetch(url).then(
      (r) => r.status !== 404 && r.status !== 400,
      () => true, // network trouble: don't claim a gap
    );
    probes.set(url, p);
  }
  return p;
}
const FADE_MS = 200;

/**
 * Time-enabled GIBS imagery as the variable overlay. One raster source+layer per frame date:
 * the current frame is shown, the next few are loaded at opacity 0 (so their tiles are fetched
 * and cached), and a new frame only replaces the old one once its tiles have arrived — so
 * scrubbing and playback never flash an empty map.
 */
export function useGibsOverlay(map: MlMap | null) {
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!map) return;
    let layerDef: GibsLayer | null = null;
    let wanted: string | null = null;
    // Sources that have received (or failed) at least one tile: before that, isSourceLoaded() can be true for an empty source.
    const touched = new Set<string>();
    // Per source: did any tile load / fail? All failed = a gap month in the product (GIBS answers 404).
    const succeeded = new Set<string>();
    /** Source id -> true when the probe found no imagery for that date. */
    const gaps = new Map<string, boolean>();
    const failed = new Set<string>();

    const idFor = (date: string) => `${PREFIX}${layerDef!.layer}-${date}`;
    const ours = () => map.getStyle().layers.filter((l) => l.id.startsWith(PREFIX)).map((l) => l.id);

    const removeAll = () => {
      for (const id of ours()) {
        map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      }
      shown.current = null;
      touched.clear();
      succeeded.clear();
      failed.clear();
    };

    const ensure = (date: string) => {
      const id = idFor(date);
      if (map.getLayer(id)) return id;
      const def = layerDef!;
      hasImagery(def, date).then((ok) => {
        if (!ok) {
          gaps.set(id, true);
          if (layerDef === def) settle();
        }
      });
      map.addSource(id, { type: 'raster', tiles: [gibsTileUrl(layerDef!, date)], tileSize: 256, maxzoom: layerDef!.max_zoom });
      map.addLayer(
        {
          id,
          type: 'raster',
          source: id,
          paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: FADE_MS, delay: 0 }, 'raster-fade-duration': 0 },
        },
        OVERLAY_BEFORE,
      );
      return id;
    };

    /**
     * Swap in one render: the new frame's tiles are already loaded, so it replaces the old one instantly
     * (a cross-fade would stack two semi-transparent layers, or let the plain basemap show through).
     */
    const show = (id: string) => {
      const { opacity, overlayOn } = useLayers.getState();
      for (const l of ours()) {
        map.setPaintProperty(l, 'raster-opacity-transition', { duration: 0, delay: 0 });
        map.setPaintProperty(l, 'raster-opacity', l === id && overlayOn ? opacity : 0);
      }
      shown.current = id;
    };

    /** Swap to the wanted frame when its tiles are in; keep only shown + wanted + prefetch. */
    const settle = () => {
      if (!layerDef || !wanted) return;
      const id = idFor(wanted);
      if (!map.getSource(id)) return;
      const gap = gaps.get(id);
      const missing = gap === true || (failed.has(id) && !succeeded.has(id));
      const ready = missing || (touched.has(id) && map.isSourceLoaded(id));
      if (ready && shown.current !== id) show(id);
      useLayers.getState().set({ loading: !ready, frameMissing: missing });
      if (ready) prune();
    };

    const prune = () => {
      if (!layerDef || !wanted) return;
      const { frames } = useLayers.getState();
      const keep = new Set<string>([idFor(wanted)]);
      if (shown.current) keep.add(shown.current);
      const n = mapConfig.variableLayer.gibsPrefetch;
      for (const d of neighbourFrames(frames, wanted, n, n)) keep.add(ensure(d));
      for (const l of ours()) {
        if (keep.has(l)) continue;
        map.removeLayer(l);
        if (map.getSource(l)) map.removeSource(l);
        touched.delete(l);
        succeeded.delete(l);
        failed.delete(l);
      }
    };

    const sync = () => {
      const s = useLayers.getState();
      const layer = s.layer;
      if (!layer || !s.date) {
        if (layerDef) removeAll();
        layerDef = null;
        wanted = null;
        useLayers.getState().set({ frameMissing: false });
        return;
      }
      if (layerDef?.layer !== layer.layer) {
        if (layerDef) removeAll();
        layerDef = layer;
      }
      wanted = s.date;
      const id = ensure(wanted);
      if (!shown.current) show(id); // first frame: show immediately, tiles stream in
      settle();
    };

    const onData = (e: { sourceId?: string; tile?: unknown }) => {
      if (!e.sourceId?.startsWith(PREFIX)) return;
      if (e.tile) {
        touched.add(e.sourceId);
        succeeded.add(e.sourceId);
      }
      settle();
    };
    const onError = (e: { sourceId?: string }) => {
      if (!e.sourceId?.startsWith(PREFIX)) return;
      touched.add(e.sourceId);
      failed.add(e.sourceId);
      settle();
    };

    sync();
    map.on('sourcedata', onData);
    map.on('idle', settle);
    map.on('error', onError);
    const unsub = useLayers.subscribe((s, p) => {
      if (s.layer !== p.layer || s.date !== p.date) sync();
      else if ((s.opacity !== p.opacity || s.overlayOn !== p.overlayOn) && shown.current && map.getLayer(shown.current)) {
        map.setPaintProperty(shown.current, 'raster-opacity-transition', { duration: 0, delay: 0 });
        map.setPaintProperty(shown.current, 'raster-opacity', s.overlayOn ? s.opacity : 0);
        map.setPaintProperty(shown.current, 'raster-opacity-transition', { duration: FADE_MS, delay: 0 });
      }
    });
    return () => {
      unsub();
      map.off('sourcedata', onData);
      map.off('idle', settle);
      map.off('error', onError);
      if (map.getStyle()) removeAll();
    };
  }, [map]);
}
