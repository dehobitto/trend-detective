import { useTexture } from '@react-three/drei';
import { useLayoutEffect } from 'react';
import { BackSide, SRGBColorSpace } from 'three';
import { globeConfig } from '../../config/globe';

/** Star field: the Tycho sky map on a large inside-out sphere, dimmed so the Earth stays the hero. */
export function Stars() {
  const sky = useTexture(globeConfig.textures.sky);
  useLayoutEffect(() => {
    sky.colorSpace = SRGBColorSpace;
    sky.needsUpdate = true;
  }, [sky]);
  return (
    <mesh raycast={() => null}>
      <sphereGeometry args={[80, 64, 32]} />
      <meshBasicMaterial map={sky} side={BackSide} color="#8b98c0" toneMapped={false} depthWrite={false} />
    </mesh>
  );
}
