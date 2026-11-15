import maplibregl, { type Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import type { BBox } from '../../api/types';
import { globeConfig } from '../../config/globe';
import { mapConfig } from '../../config/map';
import { prefersReducedMotion } from '../../config/motion';
import { wrapLon } from '../../lib/geo';
import { useStore } from '../../state/store';
import { distanceForZoom, handoff, mapPointLikeGlobe, matchedZoom, placeLikeGlobe } from '../globe/handoff';
import { useLayers } from '../layers/layerStore';
import { BasemapSwitcher, PortalControl } from './BasemapControl';
import { BeforeAfter } from './BeforeAfter';
import { addBBoxLayers, buildStyle, setBasemap, setBBoxData } from './layers';
import { registerOverlayProtocol } from './overlayProtocol';
import { useBoxSelect } from './useBoxSelect';
import { useGibsOverlay } from './useGibsOverlay';
import { useRegionLayers } from './useRegionLayers';
import { useStationMarker } from './useStationMarker';
import { useTrackpadPan } from './useTrackpadPan';
import './map.css';

/** Map zoom with the globe's scale at the end of its fly-in, for a latitude (so the crossfade doesn't jump). */
const handoffZoom = (lat: number, m: MlMap) => matchedZoom(lat, globeConfig.arrivalDistance, m.getContainer().clientHeight || window.innerHeight);
/** Preload tiles where the globe looks once it has turned this far (degrees) from the last preload. */
const PRELOAD_MOVE_DEG = 6;

/** Padding that keeps a fitted bbox clear of the investigation panel (right drawer or bottom sheet) and the timeline. */
function fitPadding() {
  const p: { top: number; bottom: number; left: number; right: number } = { ...mapConfig.fitPadding };
  if (window.innerWidth > 760) p.right = Math.min(560, window.innerWidth * 0.4) + 40;
  else p.bottom = window.innerHeight * 0.5;
  // Never let padding swallow the whole viewport on small windows.
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (p.left + p.right > w - 120) p.left = p.right = Math.max(10, (w - 120) / 2);
  if (p.top + p.bottom > h - 120) p.top = p.bottom = Math.max(10, (h - 120) / 2);
  return p;
}

const dur = (ms: number) => (prefersReducedMotion() ? 0 : ms);
const lngLatBounds = (b: BBox): [[number, number], [number, number]] => [
  [b.west, b.south],
  [b.east, b.north],
];

/** Frame a place: fit its bbox (capped zoom), or centre on the point. */
function goTo(m: MlMap, center: { lat: number; lon: number }, bounds: BBox | null | undefined, zoom: number | undefined, animate = true) {
  const duration = animate ? dur(mapConfig.flyMs) : 0;
  if (bounds) m.fitBounds(lngLatBounds(bounds), { padding: fitPadding(), maxZoom: mapConfig.search.maxZoom, duration });
  else m.flyTo({ center: [center.lon, center.lat], zoom: zoom ?? mapConfig.search.pointZoom, duration });
}

export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MlMap | null>(null);
  const [switcherHost, setSwitcherHost] = useState<HTMLElement | null>(null);
  const bbox = useStore((s) => s.bbox);
  const mapEnter = useStore((s) => s.mapEnter);
  const view = useStore((s) => s.view);
  const basemap = useLayers((s) => s.basemap);
  const mapCommand = useLayers((s) => s.mapCommand);

  // Create once; the map stays mounted for the rest of the session so hand-offs are instant.
  useEffect(() => {
    if (!container.current) return;
    registerOverlayProtocol();
    const { focus } = useStore.getState();
    const m = new maplibregl.Map({
      container: container.current,
      style: buildStyle(useLayers.getState().basemap),
      center: [focus.lon, focus.lat],
      zoom: 3.5,
      minZoom: mapConfig.minZoom,
      maxZoom: mapConfig.maxZoom,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      renderWorldCopies: true,
    });
    m.touchZoomRotate.disableRotation();
    m.keyboard.disableRotation();
    // Bottom-left stack (last added sits on top): zoom buttons, basemap switcher, attribution.
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
    const switcher = new PortalControl('basemap-ctrl');
    m.addControl(switcher, 'bottom-left');
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    // Phones: start the attribution folded to its (i) button; expanded it would cover the map hint.
    m.once('load', () => {
      if (matchMedia('(max-width: 760px)').matches) m.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
    });
    setSwitcherHost(switcher.el);
    // 'style.load' fires as soon as the style is parsed; 'load' would wait for every first tile.
    m.once('style.load', () => {
      addBBoxLayers(m);
      setBBoxData(m, useStore.getState().bbox);
      setMap(m);
    });

    // Zooming out far enough hands back to the globe (user gestures only, not fitBounds).
    m.on('zoom', (e) => {
      const s = useStore.getState();
      if (!('originalEvent' in e) || !e.originalEvent || s.flat) return;
      if (s.view === 'map' && m.getZoom() < mapConfig.returnToGlobeZoom) {
        // The globe starts from the same place on screen at the same scale as the map right now.
        const p = mapPointLikeGlobe(m);
        s.backToGlobe({ lat: p.lat, lon: wrapLon(p.lon) }, distanceForZoom(p.lat, m.getZoom(), m.getContainer().clientHeight));
      }
    });
    // Remember where the map is looking, so "Back to globe" lands over the same place.
    m.on('moveend', () => {
      const c = m.getCenter();
      if (useStore.getState().view === 'map') useStore.getState().set({ focus: { lat: c.lat, lon: wrapLon(c.lng) } });
    });
    if (import.meta.env.DEV) (window as unknown as { __tdMap: MlMap }).__tdMap = m; // debugging / screenshots
    handoff.map = m;
    return () => {
      handoff.map = null;
      m.remove();
    };
  }, []);

  useBoxSelect(map);
  useRegionLayers(map);
  useStationMarker(map);
  useGibsOverlay(map);
  useTrackpadPan(map);

  useEffect(() => {
    if (map) setBasemap(map, basemap);
  }, [map, basemap]);

  // Keep the drawn rectangle in sync with the store (panel edits, examples, clears).
  useEffect(() => {
    // A named region draws its own outline (useRegionLayers); the rectangle is only its squares' box.
    const region = useStore.getState().region;
    if (map) setBBoxData(map, region && region.bbox === bbox ? null : bbox);
    // Phones: a box drawn low on the map ends up under the bottom sheet that opens with it. Bring it into view.
    if (!map || !bbox || window.innerWidth > 760 || map.isMoving()) return;
    const { view, transition } = useStore.getState();
    if (view !== 'map' || transition !== 'idle') return;
    const pad = fitPadding();
    const sw = map.project([bbox.west, bbox.south]);
    const ne = map.project([bbox.east, bbox.north]);
    const visible = ne.y >= pad.top * 0.5 && sw.y <= window.innerHeight - pad.bottom && sw.x >= 0 && ne.x <= window.innerWidth;
    if (!visible) map.fitBounds(lngLatBounds(bbox), { padding: pad, maxZoom: map.getZoom(), duration: dur(600) });
  }, [map, bbox]);

  // Arriving from the globe: frame the example's box or the searched place, else zoom in on the focus point.
  useEffect(() => {
    const m = map;
    if (!m || mapEnter.nonce === 0) return;
    m.resize();
    const { focus, bbox: b } = useStore.getState();
    if (mapEnter.fitBBox && b) {
      m.fitBounds(lngLatBounds(b), { padding: fitPadding(), duration: dur(900), maxZoom: mapConfig.fitMaxZoom });
    } else if (mapEnter.bounds) {
      goTo(m, focus, mapEnter.bounds, mapEnter.zoom);
    } else {
      // Start exactly where and as big as the globe left off (same scale, same screen point), then glide
      // the rest of the way in: the crossfade itself has nothing to jump.
      const zoom = mapEnter.zoom ?? (mapEnter.via === 'wheel' ? mapConfig.wheelArrivalZoom : mapConfig.arrivalZoom);
      if (!useStore.getState().flat) placeLikeGlobe(m, focus.lat, focus.lon, handoffZoom(focus.lat, m));
      else m.jumpTo({ center: [focus.lon, focus.lat], zoom: Math.min(m.getZoom(), zoom) });
      m.easeTo({ center: [focus.lon, focus.lat], zoom: Math.max(zoom, m.getZoom()), duration: dur(mapConfig.flyMs), easing: (t) => 1 - Math.pow(1 - t, 3) });
    }
  }, [map, mapEnter]);

  // Search result / "Use this area" while the map is already showing.
  useEffect(() => {
    if (!map || !mapCommand) return;
    goTo(map, mapCommand.center, mapCommand.bounds, mapCommand.zoom);
  }, [map, mapCommand]);

  // While the globe is flying in (map still hidden), pre-position exactly like the globe's end frame, so the
  // tiles are loaded by the time the crossfade starts (the globe waits for `handoff.ready`).
  useEffect(() => {
    if (!map || view !== 'globe') return;
    return useStore.subscribe((s, prev) => {
      if (s.transition === 'flyingIn' && prev.transition !== 'flyingIn') {
        handoff.ready = false;
        placeLikeGlobe(map, s.focus.lat, s.focus.lon, handoffZoom(s.focus.lat, map));
        map.once('idle', () => (handoff.ready = true));
      }
    });
  }, [map, view]);

  // On the globe: keep the hidden map parked under the point the globe is looking at, at hand-off scale,
  // so the tiles for wherever the user is about to click are already cached.
  useEffect(() => {
    if (!map || view !== 'globe') return;
    let last: { lat: number; lon: number } | null = null;
    const t = window.setInterval(() => {
      const s = useStore.getState();
      if (s.transition !== 'idle' || document.hidden) return;
      const { lat, lon, distance } = handoff.look;
      if (distance > globeConfig.mapThreshold * 1.8 && last) return; // far out and nothing new: the whole hemisphere is a guess anyway
      const moved = !last || Math.hypot(lat - last.lat, ((lon - last.lon + 540) % 360) - 180) > PRELOAD_MOVE_DEG;
      if (!moved) return;
      last = { lat, lon };
      placeLikeGlobe(map, lat, lon, handoffZoom(lat, map));
    }, 1000);
    return () => window.clearInterval(t);
  }, [map, view]);

  return (
    <>
      <div ref={container} className="map" aria-label="Map. Draw a rectangle to choose the area to investigate." />
      {switcherHost && <BasemapSwitcher host={switcherHost} />}
      <BeforeAfter map={map} />
    </>
  );
}
