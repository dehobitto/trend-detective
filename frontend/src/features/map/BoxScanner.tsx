import type { Map as MlMap } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { prefersReducedMotion } from '../../config/motion';
import { useStore } from '../../state/store';
import { BBOX_LINE } from './layers';

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
  const running = useStore((s) => !!s.job && s.job.status !== 'done' && s.job.status !== 'error');
  const lens = useRef<HTMLDivElement>(null);
  const active = !!map && !!bbox && running;

  useEffect(() => {
    if (!active || !map || !bbox) return;
    const reduced = prefersReducedMotion();
    let raf = 0;
    let lastAnt = -1;
    const t0 = performance.now();
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
      let look = 0;
      if (reduced) {
        x = (c[0].x + c[2].x) / 2;
        y = (c[0].y + c[2].y) / 2;
      } else {
        const edge = Math.floor(s / EDGE_S) % 4;
        const u = (s % EDGE_S) / EDGE_S;
        const a = c[edge];
        const b = c[(edge + 1) % 4];
        const k = u < TRAVEL ? ease(u / TRAVEL) : 1;
        x = a.x + (b.x - a.x) * k;
        y = a.y + (b.y - a.y) * k;
        look = u < TRAVEL ? 0 : Math.sin(((u - TRAVEL) / (1 - TRAVEL)) * Math.PI); // pulse at the corner
        const ant = Math.floor(s * 14) % ANTS.length;
        if (ant !== lastAnt && map.getLayer(BBOX_LINE)) {
          map.setPaintProperty(BBOX_LINE, 'line-dasharray', ANTS[ant]);
          lastAnt = ant;
        }
      }
      if (el) el.style.transform = `translate(${x}px, ${y}px) translate(-30%, -30%) scale(${1 + 0.18 * look})`;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      if (map.getLayer(BBOX_LINE)) map.setPaintProperty(BBOX_LINE, 'line-dasharray', undefined);
    };
  }, [active, map, bbox]);

  if (!active || !map) return null;
  return createPortal(
    <div ref={lens} className="box-scanner" aria-hidden>
      <svg width="46" height="46" viewBox="0 0 46 46">
        <circle cx="18" cy="18" r="13" className="box-scanner__glass" />
        <circle cx="18" cy="18" r="13" className="box-scanner__rim" />
        <path d="M11 13.5a8 8 0 0 1 6-4.5" className="box-scanner__glint" />
        <path d="M27.5 27.5L40 40" className="box-scanner__handle" />
      </svg>
    </div>,
    map.getContainer(),
  );
}
