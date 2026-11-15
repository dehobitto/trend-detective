/**
 * Mock of the v2 map endpoints (GET /api/grid/{id}, /api/grid/{id}/dates, /api/geocode).
 * Only mock.ts imports this. Fields are synthetic but smooth and deterministic.
 */
import type { MockVariable } from './mockCatalog';
import type { BBox, Colormap, GridFrame, GridQuery, MapLayer, Place } from './types';

/* ------------------------------------------------------------------ map_layer per variable */

const GIBS_LAYERS: Record<string, MapLayer> = {
  modis_lst_day: {
    kind: 'gibs', layer: 'MODIS_Terra_L3_Land_Surface_Temp_Monthly_Day', tile_matrix_set: 'GoogleMapsCompatible_Level6',
    format: 'png', max_zoom: 6, time_step: 'monthly', time_start: '2000-03-01', time_end: '2026-10-01',
    legend_url: 'https://gibs.earthdata.nasa.gov/legends/MODIS_Land_Surface_Temp_H.png',
  },
  modis_lst_night: {
    kind: 'gibs', layer: 'MODIS_Terra_L3_Land_Surface_Temp_Monthly_Night', tile_matrix_set: 'GoogleMapsCompatible_Level6',
    format: 'png', max_zoom: 6, time_step: 'monthly', time_start: '2000-03-01', time_end: '2026-10-01',
    legend_url: 'https://gibs.earthdata.nasa.gov/legends/MODIS_Land_Surface_Temp_H.png',
  },
  omi_no2_trop: {
    kind: 'gibs', layer: 'OMI_Nitrogen_Dioxide_Tropo_Column', tile_matrix_set: 'GoogleMapsCompatible_Level6',
    format: 'png', max_zoom: 6, time_step: 'daily', time_start: '2004-10-01', time_end: '2026-11-09', legend_url: null,
  },
};

export function mockMapLayer(v: MockVariable): MapLayer | null {
  if (v.coverage === 'series') return null;
  return GIBS_LAYERS[v.id] ?? { kind: 'grid' };
}

/* ------------------------------------------------------------------ colormaps */

const ramp = (name: string, colors: string[], min: number, max: number): Colormap => ({
  name,
  stops: colors.map((c, i) => [min + ((max - min) * i) / (colors.length - 1), c] as [number, string]),
});

const PALETTES = {
  thermal: ['#2c105c', '#711f81', '#b63679', '#ee605e', '#fdae78', '#fcfdbf'],
  rain: ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b', '#3f007d'],
  haze: ['#ffffcc', '#fed976', '#fd8d3c', '#e31a1c', '#800026'],
  water: ['#8c510a', '#d8b365', '#f6e8c3', '#c7eae5', '#5ab4ac', '#01665e'],
};

function styleFor(v: MockVariable): { cmap: keyof typeof PALETTES; min: number; max: number } {
  if (v.units === '°C') return { cmap: 'thermal', min: -20, max: 45 };
  if (v.id.includes('precip')) return { cmap: 'rain', min: 0, max: 12 };
  if (v.sphere === 'water') {
    const b = v.base(0);
    return { cmap: 'water', min: b * 0.6, max: b * 1.3 };
  }
  const b = v.base(0);
  return { cmap: 'haze', min: 0, max: b * 2.2 };
}

/* ------------------------------------------------------------------ field synthesis */

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function mockGridDates(v: MockVariable): string[] {
  const out: string[] = [];
  const s = new Date(`${v.available_start.slice(0, 7)}-01T00:00:00Z`);
  const e = new Date(`${v.available_end}T00:00:00Z`);
  for (const d = s; d <= e; d.setUTCMonth(d.getUTCMonth() + 1)) out.push(iso(d));
  return out;
}

/** Cheap smooth pseudo-noise: a few fixed sinusoids, seeded by the variable id. */
function smooth(lat: number, lon: number, seed: number): number {
  const r = (k: number) => ((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
  let s = 0;
  for (let k = 0; k < 4; k++) {
    const fx = 0.04 + r(k) * 0.12;
    const fy = 0.04 + r(k + 10) * 0.12;
    s += Math.sin(lon * fx + r(k + 20) * 6.28) * Math.cos(lat * fy + r(k + 30) * 6.28);
  }
  return s / 4;
}

/** Very rough land mask (continents as blobs) so land variables leave the ocean transparent. */
function isLand(lat: number, lon: number): boolean {
  const blobs: [number, number, number, number][] = [
    // lat, lon, rLat, rLon
    [50, 10, 22, 35], [20, 20, 22, 22], [0, 22, 18, 16], [-22, 25, 14, 12], [45, 90, 25, 60], [22, 78, 12, 12],
    [15, 102, 12, 10], [62, 100, 14, 70], [45, -100, 20, 30], [60, -110, 14, 40], [20, -100, 8, 10],
    [-10, -60, 16, 14], [-35, -65, 12, 7], [-25, 134, 12, 18], [72, -40, 10, 14], [-80, 0, 12, 200], [35, 105, 15, 20],
  ];
  return blobs.some(([a, b, ra, rb]) => ((lat - a) / ra) ** 2 + ((lon - b) / rb) ** 2 < 1);
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function mockGrid(v: MockVariable, q: GridQuery): GridFrame {
  const bbox: BBox = q.bbox
    ? { west: clamp(q.bbox.west, -180, 180), south: clamp(q.bbox.south, -90, 90), east: clamp(q.bbox.east, -180, 180), north: clamp(q.bbox.north, -90, 90) }
    : { west: -180, south: -90, east: 180, north: 90 };
  const spanX = Math.max(0.01, bbox.east - bbox.west);
  const spanY = Math.max(0.01, bbox.north - bbox.south);
  let res = q.res ?? 1;
  res = Math.max(res, spanX / 200, spanY / 200, 0.05);
  const width = Math.max(2, Math.round(spanX / res));
  const height = Math.max(2, Math.round(spanY / res));
  const date = `${q.date.slice(0, 7)}-01`;
  const d = new Date(`${date}T00:00:00Z`);
  const year = d.getUTCFullYear() + d.getUTCMonth() / 12;
  const m = d.getUTCMonth();
  const seed = [...v.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const { cmap, min, max } = styleFor(v);
  const land = v.coverage === 'land';
  const values: (number | null)[] = new Array(width * height);
  for (let r = 0; r < height; r++) {
    const lat = bbox.north - (r + 0.5) * (spanY / height);
    // Seasons flip across the equator; tanh keeps the field smooth through the tropics.
    const hemi = Math.tanh(lat / 12);
    for (let c = 0; c < width; c++) {
      const lon = bbox.west + (c + 0.5) * (spanX / width);
      if (land && !isLand(lat, lon)) {
        values[r * width + c] = null;
        continue;
      }
      const sp = smooth(lat, lon, seed);
      const local = smooth(lat * 3, lon * 3, seed + 7) * 0.35;
      const trend = (v.trend / 10) * (year - 2000) * (1 + sp);
      let val = v.base(lat) * (1 + 0.45 * sp + local) + v.amp(lat) * hemi * Math.cos(((m - 6.5) / 12) * 2 * Math.PI) + trend;
      if (v.min !== undefined) val = Math.max(v.min, val);
      values[r * width + c] = Math.round(val * 1000) / 1000;
    }
  }
  return {
    variable_id: v.id,
    date,
    bbox,
    width,
    height,
    values,
    min,
    max,
    units: v.units,
    colormap: ramp(cmap, PALETTES[cmap], min, max),
    synthetic: true,
  };
}

/* ------------------------------------------------------------------ geocode */

const city = (name: string, country: string, lat: number, lon: number, half = 0.25, kind = 'city'): Place => ({
  name,
  display_name: `${name}, ${country}`,
  lat,
  lon,
  bbox: { west: lon - half, south: lat - half * 0.8, east: lon + half, north: lat + half * 0.8 },
  kind,
});

const GAZETTEER: Place[] = [
  city('Delhi', 'India', 28.6517, 77.2219, 0.3),
  city('New Delhi', 'Delhi, India', 28.6139, 77.209, 0.12),
  city('Delhi Cantonment', 'New Delhi, Delhi, India', 28.5921, 77.1338, 0.05, 'suburb'),
  city('Mumbai', 'Maharashtra, India', 19.076, 72.8777, 0.2),
  city('Punjab', 'India', 30.9, 75.4, 2.2, 'state'),
  city('Paris', 'Île-de-France, France', 48.8566, 2.3522, 0.15),
  city('London', 'England, United Kingdom', 51.5074, -0.1278, 0.3),
  city('New York', 'United States', 40.7128, -74.006, 0.3),
  city('Los Angeles', 'California, United States', 34.0522, -118.2437, 0.35),
  city('Cairo', 'Egypt', 30.0444, 31.2357, 0.2),
  city('Lagos', 'Nigeria', 6.5244, 3.3792, 0.25),
  city('Nairobi', 'Kenya', -1.2921, 36.8219, 0.15),
  city('Tokyo', 'Japan', 35.6762, 139.6503, 0.4),
  city('Beijing', 'China', 39.9042, 116.4074, 0.5),
  city('Jakarta', 'Indonesia', -6.2088, 106.8456, 0.2),
  city('Dhaka', 'Bangladesh', 23.8103, 90.4125, 0.15),
  city('São Paulo', 'Brazil', -23.5505, -46.6333, 0.35),
  city('Lima', 'Peru', -12.0464, -77.0428, 0.25),
  city('Mexico City', 'Mexico', 19.4326, -99.1332, 0.3),
  city('Sydney', 'New South Wales, Australia', -33.8688, 151.2093, 0.4),
  city('Moscow', 'Russia', 55.7558, 37.6173, 0.35),
  city('Kyiv', 'Ukraine', 50.4501, 30.5234, 0.2),
  city('Hilo', 'Hawaii, United States', 19.7297, -155.09, 0.08, 'town'),
  city('Sahara', 'Africa', 23.4, 13.0, 12, 'desert'),
  city('Amazon Rainforest', 'South America', -3.5, -62, 8, 'forest'),
];

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function mockGeocode(q: string, limit = 6): Place[] {
  const k = fold(q.trim());
  if (k.length < 2) return [];
  const hits = GAZETTEER.filter((p) => fold(p.display_name).includes(k));
  hits.sort((a, b) => Number(!fold(a.name).startsWith(k)) - Number(!fold(b.name).startsWith(k)));
  return hits.slice(0, limit);
}
