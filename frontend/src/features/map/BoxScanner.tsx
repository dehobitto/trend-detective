import type { Map as MlMap } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { prefersReducedMotion } from '../../config/motion';
import { useStore } from '../../state/store';
import { BBOX_LINE } from './layers';
import { outerRings } from './useRegionLayers';

/** Seconds the magnifier spends on one edge (travel + a short look at the corner). */
const EDGE_S = 1.5;
const TRAVEL = 0.7;
/** "Marching ants" for the box outline while data is being fetched (MapLibre has no dash offset, so cycle patterns). */
const ANTS: number[][] = [
  [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
  [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
];

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * While an analysis is running, a magnifying glass walks around the corners of the selected area
 * ("the detective is searching here") and the outline marches. Pure decoration: aria-hidden.
 */
export function BoxScanner({ map }: { map: MlMap | null }) {
  const bbox = useStore((s) => s.bbox);
  const region = useStore((s) => (s.region && s.region.bbox === s.bbox ? s.region : null));
  const running = useStore((s) => !!s.job && s.job.status !== 'done' && s.job.status !== 'error');
  const lens = useRef<HTMLDivElement>(null);
  const active = !!map && !!bbox && running;

  useEffect(() => {
    if (!active || !map || !bbox) return;
    const reduced = prefersReducedMotion();
    let raf = 0;
    let lastAnt = -1;
    const t0 = performance.now();
    // A named region: walk its boundary (the biggest outer ring, thinned to ~120 points) at an even pace.
    const ring = region
      ? (() => {
          const rings = outerRings(region);
          const big = rings.reduce((a, b) => (b.length > a.length ? b : a), rings[0]);
          const step = Math.max(1, Math.floor(big.length / 120));
          return big.filter((_, i) => i % step === 0);
        })()
      : null;
    const walk = (s: number): { x: number; y: number } => {
      const pts = ring!.map(([lng, lat]) => map.project([lng, lat]));
      const seg = pts.map((p, i) => Math.hypot(pts[(i + 1) % pts.length].x - p.x, pts[(i + 1) % pts.length].y - p.y));
      const total = seg.reduce((a, b) => a + b, 0) || 1;
      let dist = ((s / 9) % 1) * total; // one lap in ~9 s
      for (let i = 0; i < pts.length; i++) {
        if (dist <= seg[i]) {
          const k = seg[i] ? dist / seg[i] : 0;
          const b = pts[(i + 1) % pts.length];
          return { x: pts[i].x + (b.x - pts[i].x) * k, y: pts[i].y + (b.y - pts[i].y) * k };
        }
        dist -= seg[i];
      }
      return pts[0];
    };
    const corners = () =>
      [
        [bbox.west, bbox.north],
        [bbox.east, bbox.north],
        [bbox.east, bbox.south],
        [bbox.west, bbox.south],
      ].map(([lng, lat]) => map.project([lng, lat]));

    const frame = (now: number) => {
      const el = lens.current;
      const s = (now - t0) / 1000;
      const c = corners();
      let x: number;
      let y: number;
      if (reduced) {
        x = (c[0].x + c[2].x) / 2;
        y = (c[0].y + c[2].y) / 2;
      } else if (ring && ring.length > 2) {
        ({ x, y } = walk(s));
      } else {
        const edge = Math.floor(s / EDGE_S) % 4;
        const u = (s % EDGE_S) / EDGE_S;
        const a = c[edge];
        const b = c[(edge + 1) % 4];
        const k = u < TRAVEL ? ease(u / TRAVEL) : 1;
        x = a.x + (b.x - a.x) * k;
        y = a.y + (b.y - a.y) * k;
        const ant = Math.floor(s * 14) % ANTS.length;
        if (ant !== lastAnt && map.getLayer(BBOX_LINE)) {
          map.setPaintProperty(BBOX_LINE, 'line-dasharray', ANTS[ant]);
          lastAnt = ant;
        }
      }
      if (el) el.style.transform = `translate(${x}px, ${y}px) translate(-37%, -37%)`;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      if (map.getLayer(BBOX_LINE)) map.setPaintProperty(BBOX_LINE, 'line-dasharray', undefined);
    };
  }, [active, map, bbox, region]);

  if (!active || !map) return null;
  return createPortal(
    <div ref={lens} className="box-scanner" aria-hidden>
      <svg width="30" height="30" viewBox="0 0 30 30">
        <circle cx="11" cy="11" r="8" className="box-scanner__rim" />
        <path d="M17 17l9 9" className="box-scanner__handle" />
        <path d="M11 8.5v5M8.5 11h5" className="box-scanner__cross" />
      </svg>
    </div>,
    map.getContainer(),
  );
}
