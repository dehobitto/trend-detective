/** 2D map tunables: basemaps, overlays, zoom levels, variable layer + timeline. */
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';

export type BasemapId = 'satellite' | 'bluemarble' | 'light';

type RasterDef = {
  url: string;
  maxzoom: number;
  opacity?: number;
  attribution?: string;
  /** Route through the GIBS overlay protocol (turns GIBS' opaque black "no data" tiles transparent). */
  gibsOverlay?: boolean;
  /** Hosts that shard tiles over subdomains: list them and use {s} in the url. */
  subdomains?: string[];
};

type BasemapDef = {
  label: string;
  /** Imagery / base drawn under the variable layer. */
  base: RasterDef[];
  /** Labels, roads, borders drawn above the variable layer. */
  reference: RasterDef[];
  /** Map background behind tiles (light themes look better with a pale background). */
  background: 'space' | 'paper';
};

const ESRI_ATTR = 'Imagery © <a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri</a>, Maxar, Earthstar Geographics';
const ESRI_CANVAS_ATTR = 'Map © <a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri</a>, HERE, Garmin, © OpenStreetMap contributors';
const GIBS_ATTR = 'Imagery: <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noreferrer">NASA GIBS</a> / Blue Marble';

export const basemaps: Record<BasemapId, BasemapDef> = {
  satellite: {
    label: 'Satellite',
    background: 'space',
    base: [{ url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, maxzoom: 19, attribution: ESRI_ATTR }],
    reference: [
      { url: `${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, maxzoom: 19, opacity: 0.45 },
      { url: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, maxzoom: 19, opacity: 1 },
    ],
  },
  bluemarble: {
    label: 'Blue Marble',
    background: 'space',
    base: [{ url: `${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`, maxzoom: 8, attribution: GIBS_ATTR }],
    reference: [
      { url: `${GIBS}/Coastlines_15m/default/GoogleMapsCompatible_Level13/{z}/{y}/{x}.png`, maxzoom: 13, opacity: 0.55, gibsOverlay: true },
      { url: `${GIBS}/Reference_Labels_15m/default/GoogleMapsCompatible_Level13/{z}/{y}/{x}.png`, maxzoom: 13, opacity: 0.9, gibsOverlay: true },
    ],
  },
  light: {
    label: 'Map',
    background: 'paper',
    // Esri Light Gray Canvas (base + labels split, so the variable layer sits between them).
    // CARTO positron/light_only_labels would also fit, but CARTO now serves an "API KEY REQUIRED"
    // watermark without a key: https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png + light_only_labels.
    base: [{ url: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, maxzoom: 16, attribution: ESRI_CANVAS_ATTR }],
    reference: [
      { url: `${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, maxzoom: 19, opacity: 0.35 },
      { url: `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, maxzoom: 16 },
    ],
  },
  /*
   * Google Map Tiles API (photorealistic satellite + roads) — NOT enabled.
   * Needs an API key and a session token: POST https://tile.googleapis.com/v1/createSession?key=KEY
   * with {"mapType":"satellite","language":"en-US","region":"US","layerTypes":["layerRoadmap"]},
   * then tiles at https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=TOKEN&key=KEY
   * (and attribution from /v1/viewport). Add it as another BasemapId once a key exists:
   *
   * google: {
   *   label: 'Google',
   *   background: 'space',
   *   base: [{ url: `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${SESSION}&key=${KEY}`, maxzoom: 22, attribution: '© Google' }],
   *   reference: [],
   * },
   */
};

export const basemapOrder: BasemapId[] = ['satellite', 'light', 'bluemarble'];

export const mapConfig = {
  defaultBasemap: 'satellite' as BasemapId,
  /** Zoom used when the user clicks a place on the globe. */
  arrivalZoom: 6,
  /** Zoom used when the user wheel-zooms the globe past its hand-off threshold. */
  wheelArrivalZoom: 4.5,
  /** Zooming out below this returns to the globe. */
  returnToGlobeZoom: 1.7,
  /** 2D-only mode: start zoomed out so the whole world fits the window width (clamped to minZoom). */
  flatStartZoom: () => Math.max(1, Math.log2(window.innerWidth / 512) + 0.15),
  /** 2D-only mode is remembered on this device; ?view=2d or ?view=3d in the URL overrides it. */
  flatStorageKey: 'td.view',
  /** Hard limits for the map itself. */
  minZoom: 1,
  maxZoom: 18,
  /** Max zoom when framing an example's / the drawn bbox. */
  fitMaxZoom: 9,
  /** Padding (px) when fitting a bbox; the right side leaves room for the panel. */
  fitPadding: { top: 80, bottom: 150, left: 80, right: 80 },
  /** Ignore rectangles smaller than this (degrees) — almost certainly a mis-click. */
  minBoxDegrees: 0.25,
  /** Fly/animation duration (ms) on the map; 0 under prefers-reduced-motion. */
  flyMs: 1200,

  search: {
    debounceMs: 250,
    limit: 6,
    /** Zoom for a place without a bbox. */
    pointZoom: 10,
    /** Never zoom closer than this when fitting a place bbox. */
    maxZoom: 13,
    /** "Use this area": the area is at least this many degrees on each side. */
    minAreaDegrees: 0.5,
  },

  variableLayer: {
    opacity: 0.7,
    /** Daily GIBS layers would give thousands of frames; step through them monthly instead. */
    dailyFrameStep: 'monthly' as 'monthly' | 'daily',
    /** …using this day of each month (mid-month avoids month-boundary gaps). */
    dailyFrameDay: 15,
    /** Grid maps are drawn in this many flat colour classes (even, so 0 is a class edge on diverging maps). */
    colourClasses: 10,
    /** GIBS frames preloaded on each side of the current one (invisible layers so tiles are fetched). */
    gibsPrefetch: 2,
    /** Grid frames prefetched ahead (and 2 behind). */
    gridPrefetch: 3,
    /** Grid frames kept in memory. */
    gridCacheSize: 48,
    /** Target cells across the view for /api/grid (server caps at 200x200). */
    gridCells: 160,
    /** Target cells across the view for a trend map (/api/grid/{id}/trend: heavier, so coarser). */
    trendCells: 100,
    /** Rendered canvas size (long side, px) for grid frames (bilinear-resampled, Mercator-corrected). */
    gridCanvasPx: 640,
    /** Playback speeds: ms per frame. */
    speeds: [
      { label: '0.5×', ms: 1600 },
      { label: '1×', ms: 800 },
      { label: '2×', ms: 400 },
      { label: '4×', ms: 200 },
    ],
    defaultSpeed: 1,
    /** If a frame takes longer than this to load during playback, move on anyway. */
    maxFrameWaitMs: 4000,
  },
} as const;
