import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { useEffect } from 'react';
import type { RegionShape } from '../../api/types';
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
  return {
    type: 'FeatureCollection',
    features: r.cells.map((c) => ({
      type: 'Feature',
      properties: {},
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
      paint: { 'fill-color': '#ffd27a', 'fill-opacity': 0.06 },
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
 * light grid, and the boundary glows.
 * The plain bbox rectangle is hidden meanwhile (it is only the squares' bounding box).
 */
export function useRegionLayers(map: MlMap | null) {
  const region = useStore((s) => s.region);
  const bbox = useStore((s) => s.bbox);

  useEffect(() => {
    if (!map) return;
    ensureLayers(map);
    const active = region && bbox === region.bbox ? region : null;
    src(map, SRC_MASK)?.setData(active ? maskFeature(active) : empty);
    src(map, SRC_CELLS)?.setData(active ? cellsCollection(active) : empty);
    src(map, SRC_OUTLINE)?.setData(active ? { type: 'Feature', properties: {}, geometry: active.outline } : empty);
    setBBoxData(map, active ? null : bbox);
  }, [map, region, bbox]);
}
