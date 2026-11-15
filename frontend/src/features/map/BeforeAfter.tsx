import maplibregl, { type Map as MlMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GibsLayer } from '../../api/types';
import { mapConfig } from '../../config/map';
import { prefersReducedMotion } from '../../config/motion';
import { useStore } from '../../state/store';
import { formatFrame, gibsTileUrl } from '../layers/frames';
import { useLayers } from '../layers/layerStore';
import { OVERLAY_BEFORE, addBBoxLayers, buildStyle, setBBoxData, setBasemap } from './layers';
import { hasImagery } from './useGibsOverlay';

const BEFORE_ID = 'compare-before';
/** How many frames to step inward when GIBS has no image for the first / last date. */
const MAX_PROBE = 12;

/** First frame with imagery from `i` stepping by `dir` (or the start index if none answers). */
async function firstWithImagery(layer: GibsLayer, frames: string[], i: number, dir: 1 | -1, stopAt: number): Promise<number> {
  for (let k = 0; k < MAX_PROBE; k++) {
    const j = i + dir * k;
    if (j < 0 || j >= frames.length || (dir === 1 ? j >= stopAt : j <= stopAt)) break;
    if (await hasImagery(layer, frames[j])) return j;
  }
  return i;
}

/**
 * Pick the pair: the first frame, and the last frame in the same calendar month (so seasons don't fake
 * a change: July vs July), each moved inward past months GIBS has no image for.
 */
async function pickPair(layer: GibsLayer, frames: string[]): Promise<[string, string] | null> {
  if (frames.length < 2) return null;
  const b = await firstWithImagery(layer, frames, 0, 1, frames.length - 1);
  const month = frames[b].slice(5, 7);
  let last = frames.length - 1;
  for (let j = frames.length - 1; j > b; j--) {
    if (frames[j].slice(5, 7) === month) {
      last = j;
      break;
    }
  }
  const a = await firstWithImagery(layer, frames, last, -1, b);
  return a > b ? [frames[b], frames[a]] : null;
}

/**
 * Before/after swipe. A second, non-interactive MapLibre map with the "before" image sits over the main map
 * (which shows "after"), follows its camera, and is clipped at the divider the user drags.
 */
export function BeforeAfter({ map }: { map: MlMap | null }) {
  const compare = useLayers((s) => s.compare);
  const layer = useLayers((s) => s.layer);
  const frames = useLayers((s) => s.frames);
  const basemap = useLayers((s) => s.basemap);
  const opacity = useLayers((s) => s.opacity);
  const bbox = useStore((s) => s.bbox);
  const [pair, setPair] = useState<[string, string] | null>(null);
  const [pos, setPos] = useState(0.5);
  const holder = useRef<HTMLDivElement | null>(null);
  const second = useRef<MlMap | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const on = compare && !!map && !!layer;

  // Choose the two dates; the main map jumps to "after".
  useEffect(() => {
    if (!on || !layer) return;
    let alive = true;
    setPair(null);
    pickPair(layer, frames).then((p) => {
      if (!alive) return;
      if (!p) {
        useLayers.getState().set({ compare: false });
        useStore.getState().set({ mapNotice: 'Not enough images in this period for a before/after view.' });
        return;
      }
      setPair(p);
      useLayers.getState().set({ date: p[1], playing: false, overlayOn: true });
    });
    return () => {
      alive = false;
    };
  }, [on, layer, frames]);

  // Reveal: the divider sweeps in from the right.
  useEffect(() => {
    if (!pair || !map) return;
    // Settle in the middle of the part of the map you can see (left of the investigation panel on desktop).
    const width = map.getContainer().clientWidth || 1;
    const panel = document.querySelector('.panel')?.getBoundingClientRect();
    const visible = panel && window.innerWidth > 760 ? Math.min(width, panel.left) : width;
    const target = Math.max(0.2, Math.min(0.8, visible / 2 / width));
    if (prefersReducedMotion()) return setPos(target);
    const from = Math.min(0.95, visible / width - 0.04);
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 900);
      setPos(from - (from - target) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [pair, map]);

  // The "before" map: created when the pair is known, synced to the main camera.
  useEffect(() => {
    if (!map || !pair || !layer || !holder.current) return;
    const m2 = new maplibregl.Map({
      container: holder.current,
      style: buildStyle(useLayers.getState().basemap),
      center: map.getCenter(),
      zoom: map.getZoom(),
      interactive: false,
      attributionControl: false,
      renderWorldCopies: true,
      fadeDuration: 0,
    });
    second.current = m2;
    const sync = () => m2.jumpTo({ center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() });
    const resize = () => m2.resize();
    m2.once('style.load', () => {
      const type = map.getProjection()?.type;
      if (type && type !== 'mercator') m2.setProjection({ type }); // same sphere as the main map
      m2.addSource(BEFORE_ID, { type: 'raster', tiles: [gibsTileUrl(layer, pair[0])], tileSize: 256, maxzoom: layer.max_zoom });
      m2.addLayer(
        { id: BEFORE_ID, type: 'raster', source: BEFORE_ID, paint: { 'raster-opacity': useLayers.getState().opacity, 'raster-fade-duration': 0 } },
        OVERLAY_BEFORE,
      );
      addBBoxLayers(m2);
      setBBoxData(m2, useStore.getState().bbox);
      sync();
    });
    map.on('move', sync);
    map.on('resize', resize);
    return () => {
      map.off('move', sync);
      map.off('resize', resize);
      m2.remove();
      second.current = null;
    };
  }, [map, pair, layer]);

  useEffect(() => {
    const m2 = second.current;
    if (m2?.isStyleLoaded()) setBasemap(m2, basemap);
  }, [basemap]);
  useEffect(() => {
    const m2 = second.current;
    if (m2?.getLayer(BEFORE_ID)) m2.setPaintProperty(BEFORE_ID, 'raster-opacity', opacity);
  }, [opacity]);
  useEffect(() => {
    const m2 = second.current;
    if (m2?.isStyleLoaded()) setBBoxData(m2, bbox);
  }, [bbox]);

  // Esc leaves the comparison.
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useLayers.getState().set({ compare: false });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [on]);

  if (!on || !map || !layer) return null;
  const step = layer.time_step === 'daily' && mapConfig.variableLayer.dailyFrameStep === 'monthly' ? 'monthly' : layer.time_step;

  const drag = (e: React.PointerEvent) => {
    const el = root.current;
    if (!el) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      setPos(Math.max(0.02, Math.min(0.98, (ev.clientX - r.left) / r.width)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    move(e.nativeEvent);
  };
  const nudge = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') setPos((p) => Math.max(0.02, p - 0.05));
    if (e.key === 'ArrowRight') setPos((p) => Math.min(0.98, p + 0.05));
  };

  return createPortal(
    <div ref={root} className="ba" data-ready={!!pair}>
      <div ref={holder} className="ba__before" style={{ clipPath: `inset(0 ${(1 - pos) * 100}% 0 0)` }} aria-hidden />
      {pair && (
        <>
          <span className="ba__chip ba__chip--before" style={{ right: `calc(${(1 - pos) * 100}% + 14px)` }}>
            <small>Before</small> {formatFrame(pair[0], step)}
          </span>
          <span className="ba__chip ba__chip--after" style={{ left: `calc(${pos * 100}% + 14px)` }}>
            <small>After</small> {formatFrame(pair[1], step)}
          </span>
          <div className="ba__divider" style={{ left: `${pos * 100}%` }}>
            <button
              type="button"
              className="ba__handle"
              aria-label="Drag to compare before and after. Arrow keys move it."
              onPointerDown={drag}
              onKeyDown={nudge}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden fill="currentColor">
                <path d="M7.5 5L2.5 10l5 5zM12.5 5l5 5-5 5z" />
              </svg>
            </button>
          </div>
        </>
      )}
      {!pair && <span className="ba__chip ba__chip--loading">Finding the first and last images…</span>}
    </div>,
    map.getContainer(),
  );
}
