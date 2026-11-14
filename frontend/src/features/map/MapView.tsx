import maplibregl, { type Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { mapConfig } from '../../config/map';
import { prefersReducedMotion } from '../../config/motion';
import { wrapLon } from '../../lib/geo';
import { useStore } from '../../state/store';
import { addBBoxLayers, buildStyle, setBBoxData } from './layers';
import { registerOverlayProtocol } from './overlayProtocol';
import { useBoxSelect } from './useBoxSelect';
import { useStationMarker } from './useStationMarker';
import './map.css';

/** Padding that keeps a fitted bbox clear of the investigation panel (right drawer or bottom sheet). */
function fitPadding() {
  const p: { top: number; bottom: number; left: number; right: number } = { ...mapConfig.fitPadding };
  if (window.innerWidth > 760) p.right = Math.min(560, window.innerWidth * 0.4) + 40;
  else p.bottom = window.innerHeight * 0.5;
  return p;
}

export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MlMap | null>(null);
  const bbox = useStore((s) => s.bbox);
  const mapEnter = useStore((s) => s.mapEnter);
  const view = useStore((s) => s.view);

  // Create once; the map stays mounted for the rest of the session so hand-offs are instant.
  useEffect(() => {
    if (!container.current) return;
    registerOverlayProtocol();
    const { focus } = useStore.getState();
    const m = new maplibregl.Map({
      container: container.current,
      style: buildStyle(),
      center: [focus.lon, focus.lat],
      zoom: mapConfig.arrivalZoom,
      minZoom: mapConfig.minZoom,
      maxZoom: mapConfig.maxZoom,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      renderWorldCopies: true,
    });
    m.touchZoomRotate.disableRotation();
    m.keyboard.disableRotation();
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
    // 'style.load' fires as soon as the style is parsed; 'load' would wait for every first tile from GIBS.
    m.once('style.load', () => {
      addBBoxLayers(m);
      setBBoxData(m, useStore.getState().bbox);
      setMap(m);
    });

    // Zooming out far enough hands back to the globe (user gestures only, not fitBounds).
    m.on('zoom', (e) => {
      const s = useStore.getState();
      if (!('originalEvent' in e) || !e.originalEvent) return;
      if (s.view === 'map' && m.getZoom() < mapConfig.returnToGlobeZoom) {
        const c = m.getCenter();
        s.backToGlobe({ lat: c.lat, lon: wrapLon(c.lng) });
      }
    });
    // Remember where the map is looking, so "Back to globe" lands over the same place.
    m.on('moveend', () => {
      const c = m.getCenter();
      if (useStore.getState().view === 'map') useStore.getState().set({ focus: { lat: c.lat, lon: wrapLon(c.lng) } });
    });
    return () => m.remove();
  }, []);

  useBoxSelect(map);
  useStationMarker(map);

  // Keep the drawn rectangle in sync with the store (panel edits, examples, clears).
  useEffect(() => {
    if (map) setBBoxData(map, bbox);
  }, [map, bbox]);

  // Arriving from the globe: centre on the focus point, or frame the example's box.
  useEffect(() => {
    const m = map;
    if (!m || mapEnter.nonce === 0) return;
    m.resize();
    const { focus, bbox: b } = useStore.getState();
    if (mapEnter.fitBBox && b) {
      m.fitBounds(
        [
          [b.west, b.south],
          [b.east, b.north],
        ],
        { padding: fitPadding(), duration: prefersReducedMotion() ? 0 : 900, maxZoom: 7 },
      );
    } else {
      m.jumpTo({ center: [focus.lon, focus.lat], zoom: mapConfig.arrivalZoom });
    }
  }, [map, mapEnter]);

  // While the globe is flying in (map still hidden), pre-position so tiles start loading.
  useEffect(() => {
    if (!map || view !== 'globe') return;
    return useStore.subscribe((s, prev) => {
      if (s.transition === 'flyingIn' && prev.transition !== 'flyingIn') {
        map.jumpTo({ center: [s.focus.lon, s.focus.lat], zoom: mapConfig.arrivalZoom });
      }
    });
  }, [map, view]);

  return <div ref={container} className="map" aria-label="Map. Draw a rectangle to choose the area to investigate." />;
}
