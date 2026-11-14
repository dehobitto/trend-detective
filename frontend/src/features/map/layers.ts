import type { Map as MlMap, StyleSpecification } from 'maplibre-gl';
import type { BBox } from '../../api/types';
import { colors } from '../../config/colors';
import { mapConfig } from '../../config/map';
import { bboxToPolygon } from '../../lib/geo';
import { overlayUrl } from './overlayProtocol';

export const BBOX_SOURCE = 'bbox';
export const BBOX_FILL = 'bbox-fill';
export const BBOX_LINE = 'bbox-line';

/** Raster-only style: GIBS Blue Marble + coastlines + reference labels. */
export function buildStyle(): StyleSpecification {
  const raster = (url: string, maxzoom: number, attribution?: string) => ({
    type: 'raster' as const,
    tiles: [url],
    tileSize: 256,
    maxzoom,
    ...(attribution ? { attribution } : {}),
  });
  return {
    version: 8,
    sources: {
      basemap: raster(mapConfig.basemap.url, mapConfig.basemap.maxzoom, mapConfig.attribution),
      coastlines: raster(overlayUrl(mapConfig.coastlines.url), mapConfig.coastlines.maxzoom),
      labels: raster(overlayUrl(mapConfig.labels.url), mapConfig.labels.maxzoom),
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': colors.space } },
      { id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-fade-duration': 150 } },
      { id: 'coastlines', type: 'raster', source: 'coastlines', paint: { 'raster-opacity': mapConfig.coastlines.opacity } },
      { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': mapConfig.labels.opacity } },
    ],
  };
}

const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export function addBBoxLayers(map: MlMap) {
  map.addSource(BBOX_SOURCE, { type: 'geojson', data: empty });
  map.addLayer({
    id: BBOX_FILL,
    type: 'fill',
    source: BBOX_SOURCE,
    paint: { 'fill-color': colors.ink, 'fill-opacity': 0.1 },
  });
  map.addLayer({
    id: BBOX_LINE,
    type: 'line',
    source: BBOX_SOURCE,
    paint: { 'line-color': colors.ink, 'line-width': 2, 'line-opacity': 0.95 },
  });
}

export function setBBoxData(map: MlMap, bbox: BBox | null) {
  const src = map.getSource(BBOX_SOURCE) as { setData?: (d: GeoJSON.GeoJSON) => void } | undefined;
  src?.setData?.(bbox ? { type: 'FeatureCollection', features: [bboxToPolygon(bbox)] } : empty);
}
