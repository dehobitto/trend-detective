import { Canvas } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { globeConfig } from '../../config/globe';
import { fadeMs } from '../../config/motion';
import { formatLat, formatLon } from '../../lib/geo';
import { useStore } from '../../state/store';
import { Atmosphere } from './Atmosphere';
import { CameraRig } from './CameraRig';
import { Earth } from './Earth';
import { Starfield } from './Starfield';
import { GlobeOverlay } from './GlobeOverlay';
import { GlobeIntro } from './GlobeIntro';
import { Graticule } from './Graticule';
import { StationMarker } from './StationMarker';
import { globeUniforms } from './sun';
import type { Camera } from 'three';
import { vector3ToLatLon } from '../../lib/geo';
import './globe.css';

type Hover = { lat: number; lon: number; x: number; y: number } | null;

export function GlobeView() {
  const view = useStore((s) => s.view);
  const transition = useStore((s) => s.transition);
  const flyTo = useStore((s) => s.flyTo);
  const [paused, setPaused] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<Camera | null>(null);

  // Hover readout is written straight to the DOM: a React state update here would re-render the whole
  // 3D scene on every mouse move and make the spinning globe stutter.
  const setHover = useCallback((h: Hover) => {
    const tip = tipRef.current;
    const root = rootRef.current;
    if (!tip || !root) return;
    const on = !!h && root.dataset.interactive === 'true' && globeUniforms.uGrid.value > 0.5; // coordinates only when zoomed in
    tip.hidden = !on;
    root.style.cursor = on ? 'pointer' : '';
    if (!on || !h) return;
    tip.style.left = `${h.x + 14}px`;
    tip.style.top = `${h.y + 14}px`;
    tip.textContent = `${formatLat(h.lat)}, ${formatLon(h.lon)}`;
  }, []);

  // Stop rendering once the map has fully faded in; start again the moment we head back.
  useEffect(() => {
    if (view === 'globe') {
      setPaused(false);
      return;
    }
    const t = window.setTimeout(() => setPaused(true), fadeMs() + 50);
    return () => window.clearTimeout(t);
  }, [view]);

  const interactive = view === 'globe' && transition === 'idle';
  useEffect(() => {
    if (!interactive) setHover(null);
  }, [interactive, setHover]);

  return (
    <div ref={rootRef} className="globe" data-interactive={interactive}>
      <Canvas
        frameloop={paused ? 'never' : 'always'}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ fov: globeConfig.fov, near: 0.05, far: 200, position: [0, 0, globeConfig.defaultDistance] }}
        onCreated={({ gl, camera }) => {
          gl.setClearColor(0x000000, 0);
          cameraRef.current = camera;
        }}
        // A click on empty space (not the Earth) opens the map on whatever the globe is facing.
        onPointerMissed={(e) => {
          const cam = cameraRef.current;
          if (!interactive || !cam || e.button !== 0) return;
          setHover(null);
          flyTo(vector3ToLatLon(cam.position.clone().normalize()));
        }}
        aria-label="3D globe. Drag to turn, scroll to zoom, click a place to open the map there."
        role="img"
      >
        <Suspense fallback={null}>
          <GlobeIntro>
            <Earth
              interactive={interactive}
              onHover={setHover}
              onPick={(lat, lon) => {
                setHover(null);
                flyTo({ lat, lon });
              }}
            />
            <GlobeOverlay />
            <Graticule />
            <Atmosphere />
            <StationMarker />
          </GlobeIntro>
        </Suspense>
        {/* The sky loads on its own, after the Earth: the globe never waits for the stars. */}
        <Suspense fallback={null}>
          <Starfield />
        </Suspense>
        <CameraRig />
      </Canvas>
      <div ref={tipRef} className="globe__hover" hidden aria-hidden />
    </div>
  );
}
