import type { Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import { useEffect, useState } from 'react';
import { mapConfig } from '../../config/map';
import { prefersReducedMotion } from '../../config/motion';
import { wrapLon } from '../../lib/geo';
import { useStore } from '../../state/store';
import { BBOX_FILL } from './layers';

/** Below this zoom the map is "the globe": click flies in, the planet idles round, the grid shows. */
const GLOBE_ZOOM = 4;
/** Degrees per second of idle rotation, and how long after the last touch it starts. */
const SPIN_DEG_S = 2.2;
const SPIN_AFTER_MS = 4000;
const GRID = 'graticule';

function graticule(step = 15): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (let lon = -180; lon < 180; lon += step) {
    const coords: GeoJSON.Position[] = [];
    for (let lat = -85; lat <= 85; lat += 2.5) coords.push([lon, lat]);
    features.push({ type: 'Feature', properties: { major: lon % 30 === 0 }, geometry: { type: 'LineString', coordinates: coords } });
  }
  for (let lat = -75; lat <= 75; lat += step) {
    const coords: GeoJSON.Position[] = [];
    for (let lon = -180; lon <= 180; lon += 2.5) coords.push([lon, lat]);
    features.push({ type: 'Feature', properties: { major: lat % 30 === 0, equator: lat === 0 }, geometry: { type: 'LineString', coordinates: coords } });
  }
  return { type: 'FeatureCollection', features };
}

/** Hairline lat/lon grid over the planet that fades out as you zoom in (the instrument look of the old globe). */
function ensureGrid(map: MlMap, on: boolean) {
  if (!map.getSource(GRID)) {
    map.addSource(GRID, { type: 'geojson', data: graticule() });
    map.addLayer(
      {
        id: GRID,
        type: 'line',
        source: GRID,
        paint: {
          'line-color': '#ffffff',
          'line-width': ['case', ['get', 'equator'], 1.1, 0.7],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 1, ['case', ['get', 'major'], 0.5, 0.24], GLOBE_ZOOM, 0],
        },
      },
      BBOX_FILL,
    );
  }
  map.setLayoutProperty(GRID, 'visibility', on ? 'visible' : 'none');
}

/** Labels only once you are close enough to read them: a clean planet from far away. */
function labelsFromZoom(map: MlMap, globe: boolean) {
  for (const layer of map.getStyle().layers) {
    if (layer.id.startsWith('ref-')) map.setLayerZoomRange(layer.id, globe ? 2.6 : 0, 24);
  }
}

/**
 * The seamless globe (MapLibre sphere) behaves like the old three.js globe: a click flies down to the place,
 * the planet slowly turns while nobody touches it, a hairline grid shows from far away, and "show the station"
 * turns the globe to face it. Returns the coordinates under the pointer while zoomed out (for a readout).
 */
export function useSeamlessGlobe(map: MlMap | null) {
  const flat = useStore((s) => s.flat);
  const [hover, setHover] = useState<{ x: number; y: number; lat: number; lon: number } | null>(null);

  useEffect(() => {
    if (!map) return;
    ensureGrid(map, flat);
    labelsFromZoom(map, flat);
    if (!flat) return;

    // Click to fly in (only far out, not while drawing, not on the drawn box itself).
    const onClick = (e: MapMouseEvent) => {
      const s = useStore.getState();
      if (s.drawing || map.getZoom() >= GLOBE_ZOOM) return;
      s.flyTo({ lat: e.lngLat.lat, lon: wrapLon(e.lngLat.lng) }, false, { via: 'click', zoom: mapConfig.arrivalZoom });
    };
    const onMove = (e: MapMouseEvent) => {
      if (map.getZoom() >= GLOBE_ZOOM || useStore.getState().drawing) return setHover(null);
      setHover({ x: e.point.x, y: e.point.y, lat: e.lngLat.lat, lon: wrapLon(e.lngLat.lng) });
    };
    const onOut = () => setHover(null);
    // The idle spin moves the map every frame: only a user's move hides the readout.
    const onMoveStart = (e: { originalEvent?: unknown }) => e.originalEvent && setHover(null);
    // Pointer cursor only where a click flies in (far out).
    const markGlobe = () => map.getContainer().classList.toggle('is-globe', map.getZoom() < GLOBE_ZOOM);
    markGlobe();
    map.on('zoom', markGlobe);
    map.on('click', onClick);
    map.on('mousemove', onMove);
    map.on('mouseout', onOut);
    map.on('movestart', onMoveStart);

    // Idle rotation on the home screen.
    let last = performance.now();
    let touched = performance.now();
    let raf = 0;
    const touch = () => (touched = performance.now());
    const el = map.getCanvasContainer();
    ['pointerdown', 'wheel', 'touchstart', 'keydown'].forEach((t) => el.addEventListener(t, touch, { passive: true }));
    const spin = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = useStore.getState();
      const idle = now - touched > SPIN_AFTER_MS && !map.isMoving() && !s.bbox && !s.drawing && !s.job && s.view === 'map';
      if (idle && !prefersReducedMotion() && map.getZoom() < 3 && !document.hidden) {
        const c = map.getCenter();
        map.jumpTo({ center: [c.lng + SPIN_DEG_S * dt, c.lat] });
      }
      raf = requestAnimationFrame(spin);
    };
    raf = requestAnimationFrame(spin);

    // "Show the station" (global records): turn the globe to face it, without diving in.
    const unsubPeek = useStore.subscribe((s, p) => {
      if (s.peek && s.peek.nonce !== p.peek?.nonce) {
        touch();
        map.flyTo({ center: [s.peek.lon, s.peek.lat], zoom: Math.min(map.getZoom(), 2.6), duration: prefersReducedMotion() ? 0 : 1600, essential: true });
      }
    });

    return () => {
      map.off('zoom', markGlobe);
      map.getContainer().classList.remove('is-globe');
      map.off('click', onClick);
      map.off('mousemove', onMove);
      map.off('mouseout', onOut);
      map.off('movestart', onMoveStart);
      ['pointerdown', 'wheel', 'touchstart', 'keydown'].forEach((t) => el.removeEventListener(t, touch));
      cancelAnimationFrame(raf);
      unsubPeek();
      setHover(null);
    };
  }, [map, flat]);

  return hover;
}

