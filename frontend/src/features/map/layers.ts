import type { Map as MlMap, StyleSpecification } from 'maplibre-gl';
import type { BBox } from '../../api/types';
import { basemapOrder, basemaps, mapConfig, type BasemapId } from '../../config/map';
import { bboxToPolygon } from '../../lib/geo';
import { overlayUrl } from './overlayProtocol';

export const BBOX_SOURCE = 'bbox';
export const BBOX_FILL = 'bbox-fill';
export const BBOX_CASING = 'bbox-casing';
export const BBOX_LINE = 'bbox-line';

/** The variable overlay is inserted right below this layer, i.e. under all labels/roads/borders. */
export const OVERLAY_BEFORE = 'overlay-anchor';

/** Tile-area backgrounds (where tiles are missing). Imagery reads best on deep ocean blue; the light map on paper. */
const BACKGROUND = { space: '#0a1424', paper: '#f2f1ec' } as const;

const baseId = (b: BasemapId, i: number) => `base-${b}-${i}`;
const refId = (b: BasemapId, i: number) => `ref-${b}-${i}`;

function expand(url: string, subdomains?: string[]): string[] {
  return subdomains?.length ? subdomains.map((s) => url.replace('{s}', s)) : [url];
}

/**
 * Raster style with every basemap preloaded as hidden layers (hidden layers fetch no tiles):
 *   background → basemap imagery → [anchor: variable overlay goes here] → labels/roads/borders → bbox.
 */
export function buildStyle(active: BasemapId = mapConfig.defaultBasemap): StyleSpecification {
  const sources: StyleSpecification['sources'] = {};
  const baseLayers: StyleSpecification['layers'] = [];
  const refLayers: StyleSpecification['layers'] = [];
  for (const id of basemapOrder) {
    const def = basemaps[id];
    const visibility = id === active ? 'visible' : 'none';
    def.base.forEach((r, i) => {
      sources[baseId(id, i)] = { type: 'raster', tiles: expand(r.url, r.subdomains), tileSize: 256, maxzoom: r.maxzoom, ...(r.attribution ? { attribution: r.attribution } : {}) };
      baseLayers.push({ id: baseId(id, i), type: 'raster', source: baseId(id, i), layout: { visibility }, paint: { 'raster-fade-duration': 150, 'raster-opacity': r.opacity ?? 1 } });
    });
    def.reference.forEach((r, i) => {
      const tiles = expand(r.url, r.subdomains).map((u) => (r.gibsOverlay ? overlayUrl(u) : u));
      sources[refId(id, i)] = { type: 'raster', tiles, tileSize: 256, maxzoom: r.maxzoom, ...(r.attribution ? { attribution: r.attribution } : {}) };
      refLayers.push({ id: refId(id, i), type: 'raster', source: refId(id, i), layout: { visibility }, paint: { 'raster-opacity': r.opacity ?? 1 } });
    });
  }
  return {
    version: 8,
    sources,
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': BACKGROUND[basemaps[active].background] } },
      ...baseLayers,
      // Zero-size anchor so overlays can be inserted between imagery and labels whatever the basemap.
      { id: OVERLAY_BEFORE, type: 'background', layout: { visibility: 'none' } },
      ...refLayers,
    ],
  };
}

export function setBasemap(map: MlMap, active: BasemapId) {
  for (const id of basemapOrder) {
    const v = id === active ? 'visible' : 'none';
    basemaps[id].base.forEach((_, i) => map.setLayoutProperty(baseId(id, i), 'visibility', v));
    basemaps[id].reference.forEach((_, i) => map.setLayoutProperty(refId(id, i), 'visibility', v));
  }
  map.setPaintProperty('background', 'background-color', BACKGROUND[basemaps[active].background]);
}

const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Box outline: white line on a dark casing so it reads on imagery, the light map and heatmaps alike. */
export function addBBoxLayers(map: MlMap) {
  map.addSource(BBOX_SOURCE, { type: 'geojson', data: empty });
  map.addLayer({ id: BBOX_FILL, type: 'fill', source: BBOX_SOURCE, paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.08 } });
  map.addLayer({ id: BBOX_CASING, type: 'line', source: BBOX_SOURCE, paint: { 'line-color': '#0b1020', 'line-width': 4.5, 'line-opacity': 0.55 } });
  map.addLayer({ id: BBOX_LINE, type: 'line', source: BBOX_SOURCE, paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-opacity': 0.95 } });
}

export function setBBoxData(map: MlMap, bbox: BBox | null) {
  const src = map.getSource(BBOX_SOURCE) as { setData?: (d: GeoJSON.GeoJSON) => void } | undefined;
  src?.setData?.(bbox ? { type: 'FeatureCollection', features: [bboxToPolygon(bbox)] } : empty);
}
