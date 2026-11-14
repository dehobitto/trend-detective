/** 2D map tunables. NASA GIBS tiles: no API key needed. */
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

export const mapConfig = {
  basemap: {
    url: `${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`,
    maxzoom: 8,
  },
  coastlines: {
    url: `${GIBS}/Coastlines_15m/default/GoogleMapsCompatible_Level13/{z}/{y}/{x}.png`,
    maxzoom: 13,
    opacity: 0.55,
  },
  labels: {
    url: `${GIBS}/Reference_Labels_15m/default/GoogleMapsCompatible_Level13/{z}/{y}/{x}.png`,
    maxzoom: 13,
    opacity: 0.9,
  },
  attribution:
    'Imagery: <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noreferrer">NASA GIBS</a> / Blue Marble',
  /** Zoom used when arriving from the globe. */
  arrivalZoom: 3.5,
  /** Zooming out below this returns to the globe. */
  returnToGlobeZoom: 1.7,
  /** Hard limits for the map itself. */
  minZoom: 1,
  maxZoom: 10,
  /** Padding (px) when fitting a bbox; the right side leaves room for the panel. */
  fitPadding: { top: 80, bottom: 80, left: 80, right: 80 },
  /** Ignore rectangles smaller than this (degrees) — almost certainly a mis-click. */
  minBoxDegrees: 0.25,
} as const;
