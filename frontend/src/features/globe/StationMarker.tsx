import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { AdditiveBlending, DoubleSide, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import { colors } from '../../config/colors';
import { useReducedMotion } from '../../config/motion';
import { latLonToVector3 } from '../../lib/geo';
import { useSelectedVariable } from '../../state/store';

const Z = new Vector3(0, 0, 1);
const toCam = new Vector3();
const PULSE_S = 2.2;

/**
 * Where a station record comes from (e.g. Mauna Loa): a small dot with a slow pulse and a label,
 * sitting on the globe surface at the variable's location. Uses the same lat/lon -> vector maths as
 * the click raycast and fly-to (lib/geo.ts), so it lands where a click on that spot would read.
 */
export function StationMarker() {
  const variable = useSelectedVariable();
  const loc = variable?.location ?? null;
  if (!loc) return null;
  return <Marker key={`${loc.lat},${loc.lon}`} lat={loc.lat} lon={loc.lon} label={loc.label} />;
}

function Marker({ lat, lon, label }: { lat: number; lon: number; label: string }) {
  const reduced = useReducedMotion();
  const ring = useRef<Mesh>(null);
  const labelEl = useRef<HTMLDivElement>(null);
  const { pos, normal, quat } = useMemo(() => {
    const normal = latLonToVector3(lat, lon, 1);
    return {
      pos: normal.clone().multiplyScalar(1.002),
      normal,
      // Circles are built in the XY plane; turn them to lie flat on the surface.
      quat: new Quaternion().setFromUnitVectors(Z, normal),
    };
  }, [lat, lon]);

  useFrame(({ camera, clock }) => {
    // Hide the label once the station turns to the far side of the globe.
    toCam.copy(camera.position).sub(pos).normalize();
    const facing = toCam.dot(normal);
    if (labelEl.current) labelEl.current.style.opacity = String(Math.max(0, Math.min(1, (facing - 0.15) * 4)));
    const r = ring.current;
    if (!r) return;
    const m = r.material as MeshBasicMaterial;
    if (reduced) {
      r.scale.setScalar(1.6);
      m.opacity = 0.55;
      return;
    }
    const t = (clock.elapsedTime % PULSE_S) / PULSE_S;
    r.scale.setScalar(1 + t * 2.4);
    m.opacity = 0.75 * (1 - t);
  });

  return (
    <group position={pos} quaternion={quat}>
      <mesh renderOrder={10}>
        <circleGeometry args={[0.009, 24]} />
        <meshBasicMaterial color={colors.ink} depthWrite={false} side={DoubleSide} />
      </mesh>
      <mesh ref={ring} renderOrder={10}>
        <ringGeometry args={[0.011, 0.014, 40]} />
        <meshBasicMaterial color={colors.ink} transparent depthWrite={false} blending={AdditiveBlending} side={DoubleSide} />
      </mesh>
      <Html zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
        <div ref={labelEl} className="station-label">
          {label}
        </div>
      </Html>
    </group>
  );
}
