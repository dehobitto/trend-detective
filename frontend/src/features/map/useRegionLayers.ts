import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { useEffect } from 'react';
import type { RegionShape } from '../../api/types';
import { useStore } from '../../state/store';
import { BBOX_FILL, setBBoxData } from './layers';

const SRC_MASK = 'region-mask';
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

function ensureLayers(map: MlMap) {
  if (map.getSource(SRC_MASK)) return;
  map.addSource(SRC_MASK, { type: 'geojson', data: empty });
  map.addSource(SRC_OUTLINE, { type: 'geojson', data: empty });
  // Under the box layers: dim everything outside the region, then the softly glowing outline.
  map.addLayer({ id: 'region-mask', type: 'fill', source: SRC_MASK, paint: { 'fill-color': '#0b1020', 'fill-opacity': 0.42 } }, BBOX_FILL);
  map.addLayer({ id: 'region-glow', type: 'line', source: SRC_OUTLINE, paint: { 'line-color': '#ffb547', 'line-width': 5, 'line-blur': 3, 'line-opacity': 0.35 } }, BBOX_FILL);
  map.addLayer({ id: 'region-casing', type: 'line', source: SRC_OUTLINE, paint: { 'line-color': '#0b1020', 'line-width': 3.5, 'line-opacity': 0.45 } }, BBOX_FILL);
  map.addLayer({ id: 'region-line', type: 'line', source: SRC_OUTLINE, paint: { 'line-color': '#ffffff', 'line-width': 1.8 }, layout: { 'line-join': 'round', 'line-cap': 'round' } }, BBOX_FILL);
}

const src = (map: MlMap, id: string) => map.getSource(id) as GeoJSONSource | undefined;

/**
 * A named region on the map: the area outside is dimmed, and the real boundary is drawn with a soft glow.
 * (The analysis still averages the grid squares inside it: satellite data comes on a grid.)
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
    src(map, SRC_OUTLINE)?.setData(active ? { type: 'Feature', properties: {}, geometry: active.outline } : empty);
    setBBoxData(map, active ? null : bbox);
  }, [map, region, bbox]);
}
