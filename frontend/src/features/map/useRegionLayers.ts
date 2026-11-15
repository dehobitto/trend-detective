import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { useEffect } from 'react';
import type { RegionShape } from '../../api/types';
import { prefersReducedMotion } from '../../config/motion';
import { useStore } from '../../state/store';
import { BBOX_FILL, setBBoxData } from './layers';

const SRC_MASK = 'region-mask';
const SRC_CELLS = 'region-cells';
const SRC_OUTLINE = 'region-outline';
const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Outer rings of the region's polygons (holes in the world mask; the magnifier walks the biggest one). */
export function outerRings(r: RegionShape): GeoJSON.Position[][] {
  return r.outline.type === 'Polygon' ? [r.outline.coordinates[0]] : r.outline.coordinates.map((p) => p[0]);
}

function maskFeature(r: RegionShape): GeoJSON.Feature<GeoJSON.Polygon> {
  const world: GeoJSON.Position[] = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [world, ...outerRings(r)] } };
}

function cellsCollection(r: RegionShape): GeoJSON.FeatureCollection {
  const cx = (r.bbox.west + r.bbox.east) / 2;
  const cy = (r.bbox.south + r.bbox.north) / 2;
  const maxD = Math.hypot(r.bbox.east - r.bbox.west, r.bbox.north - r.bbox.south) / 2 || 1;
  return {
    type: 'FeatureCollection',
    features: r.cells.map((c, i) => ({
      type: 'Feature',
      id: i,
      // Distance from the centre (0..1): the loading wave ripples outward.
      properties: { d: Math.hypot((c.west + c.east) / 2 - cx, (c.south + c.north) / 2 - cy) / maxD },
      geometry: { type: 'Polygon', coordinates: [[[c.west, c.south], [c.east, c.south], [c.east, c.north], [c.west, c.north], [c.west, c.south]]] },
    })),
  };
}

function ensureLayers(map: MlMap) {
  if (map.getSource(SRC_MASK)) return;
  map.addSource(SRC_MASK, { type: 'geojson', data: empty });
  map.addSource(SRC_CELLS, { type: 'geojson', data: empty });
  map.addSource(SRC_OUTLINE, { type: 'geojson', data: empty });
  // Under the box layers: dim everything outside the region, then the squares, then the glowing outline.
  map.addLayer({ id: 'region-mask', type: 'fill', source: SRC_MASK, paint: { 'fill-color': '#0b1020', 'fill-opacity': 0.42 } }, BBOX_FILL);
  map.addLayer(
    {
      id: 'region-cells-fill',
      type: 'fill',
      source: SRC_CELLS,
      paint: { 'fill-color': '#ffd27a', 'fill-opacity': ['+', 0.04, ['*', 0.34, ['coalesce', ['feature-state', 'lit'], 0]]] },
    },
    BBOX_FILL,
  );
  map.addLayer({ id: 'region-cells-line', type: 'line', source: SRC_CELLS, paint: { 'line-color': '#ffffff', 'line-width': 0.8, 'line-opacity': 0.45 } }, BBOX_FILL);
  map.addLayer({ id: 'region-glow', type: 'line', source: SRC_OUTLINE, paint: { 'line-color': '#ffb547', 'line-width': 9, 'line-blur': 7, 'line-opacity': 0.75 } }, BBOX_FILL);
  map.addLayer({ id: 'region-casing', type: 'line', source: SRC_OUTLINE, paint: { 'line-color': '#0b1020', 'line-width': 4.5, 'line-opacity': 0.6 } }, BBOX_FILL);
  map.addLayer({ id: 'region-line', type: 'line', source: SRC_OUTLINE, paint: { 'line-color': '#ffffff', 'line-width': 2.2 } }, BBOX_FILL);
}

const src = (map: MlMap, id: string) => map.getSource(id) as GeoJSONSource | undefined;

/**
 * A named region on the map: the area outside is dimmed, the squares the analysis uses are drawn as a
 * light grid, and the boundary glows. While its analysis runs, a wave of light ripples across the squares.
 * The plain bbox rectangle is hidden meanwhile (it is only the squares' bounding box).
 */
export function useRegionLayers(map: MlMap | null) {
  const region = useStore((s) => s.region);
  const bbox = useStore((s) => s.bbox);
  const running = useStore((s) => !!s.job && s.job.status !== 'done' && s.job.status !== 'error');

  useEffect(() => {
    if (!map) return;
    ensureLayers(map);
    const active = region && bbox === region.bbox ? region : null;
    src(map, SRC_MASK)?.setData(active ? maskFeature(active) : empty);
    src(map, SRC_CELLS)?.setData(active ? cellsCollection(active) : empty);
    src(map, SRC_OUTLINE)?.setData(active ? { type: 'Feature', properties: {}, geometry: active.outline } : empty);
    setBBoxData(map, active ? null : bbox);
  }, [map, region, bbox]);

  // Loading wave: brightness rolls outward from the centre while the data comes in.
  useEffect(() => {
    if (!map || !region || !running) return;
    const n = region.cells.length;
    const d = cellsCollection(region).features.map((f) => (f.properties as { d: number }).d);
    const reduced = prefersReducedMotion();
    let raf = 0;
    let last = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      if (now - last > 66) {
        last = now;
        const t = (now - t0) / 1000;
        for (let i = 0; i < n; i++) {
          const lit = reduced ? 0.5 : Math.pow(Math.max(0, Math.sin((t * 1.6 - d[i] * 3.2) * Math.PI)), 3);
          map.setFeatureState({ source: SRC_CELLS, id: i }, { lit });
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      if (map.getSource(SRC_CELLS)) for (let i = 0; i < n; i++) map.setFeatureState({ source: SRC_CELLS, id: i }, { lit: 0 });
    };
  }, [map, region, running]);
}
