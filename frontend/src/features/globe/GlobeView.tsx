import { Canvas } from '@react-three/fiber';
import { Suspense, useEffect, useState } from 'react';
import { globeConfig } from '../../config/globe';
import { fadeMs } from '../../config/motion';
import { formatLat, formatLon } from '../../lib/geo';
import { useStore } from '../../state/store';
import { Atmosphere } from './Atmosphere';
import { CameraRig } from './CameraRig';
import { Earth } from './Earth';
import { StationMarker } from './StationMarker';
import './globe.css';

type Hover = { lat: number; lon: number; x: number; y: number } | null;

export function GlobeView() {
  const view = useStore((s) => s.view);
  const transition = useStore((s) => s.transition);
  const flyTo = useStore((s) => s.flyTo);
  const [hover, setHover] = useState<Hover>(null);
  const [paused, setPaused] = useState(false);

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

  return (
    <div className="globe" data-interactive={interactive} style={{ cursor: hover && interactive ? 'pointer' : undefined }}>
      <Canvas
        frameloop={paused ? 'never' : 'always'}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ fov: globeConfig.fov, near: 0.05, far: 200, position: [0, 0, globeConfig.defaultDistance] }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
        aria-label="3D globe. Drag to turn, scroll to zoom, click a place to open the map there."
        role="img"
      >
        <Suspense fallback={null}>
          <Earth
            interactive={interactive}
            onHover={setHover}
            onPick={(lat, lon) => {
              setHover(null);
              flyTo({ lat, lon });
            }}
          />
          <Atmosphere />
          <StationMarker />
        </Suspense>
        <CameraRig />
      </Canvas>
      {hover && interactive && (
        <div className="globe__hover" style={{ left: hover.x + 14, top: hover.y + 14 }} aria-hidden>
          {formatLat(hover.lat)}, {formatLon(hover.lon)}
        </div>
      )}
    </div>
  );
}
