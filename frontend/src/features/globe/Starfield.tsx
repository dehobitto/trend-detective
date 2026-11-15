import { useTexture } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Color, DoubleSide, type Mesh, MeshBasicMaterial, SRGBColorSpace } from 'three';
import { globeConfig } from '../../config/globe';
import { gmstDeg, useSun } from './sun';

const RAD = Math.PI / 180;

/**
 * The night sky behind the globe: NASA SVS "Deep Star Maps 2020" (public domain), an equirectangular star map
 * in celestial coordinates (RA 0h at the centre, RA increasing to the left), tone-mapped to a JPEG.
 *
 * A sphere around the camera (no parallax). Oriented for real: the celestial pole is the Earth's axis and the
 * sky turns with sidereal time, so with live sunlight the stars stand where they really are over the Earth
 * (and wheel round during "Spin a day"). Dimmed so it stays a backdrop.
 */
export function Starfield() {
  const map = useTexture(globeConfig.textures.stars);
  const camera = useThree((s) => s.camera);
  const mesh = useRef<Mesh>(null);

  useLayoutEffect(() => {
    map.colorSpace = SRGBColorSpace;
    map.anisotropy = 4;
    map.needsUpdate = true;
  }, [map]);

  const material = useMemo(
    () => new MeshBasicMaterial({ map, color: new Color().setScalar(globeConfig.starBrightness), side: DoubleSide, depthWrite: false, toneMapped: false }),
    [map],
  );

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    m.position.copy(camera.position);
    // Texel at RA α sits at geometric longitude −α; mirror (scale.z = −1) turns that into +α, then rotate by
    // −GMST so RA α lands over longitude α − GMST, where that star is overhead right now.
    m.rotation.y = -gmstDeg(Date.now() + useSun.getState().offsetMs) * RAD;
  });

  return (
    <mesh ref={mesh} material={material} scale={[90, 90, -90]} renderOrder={-1} frustumCulled={false} raycast={() => null}>
      <sphereGeometry args={[1, 96, 48]} />
    </mesh>
  );
}
