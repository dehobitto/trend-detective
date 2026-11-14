import { useTexture } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useThree } from '@react-three/fiber';
import { useLayoutEffect } from 'react';
import { Color, SRGBColorSpace } from 'three';
import { globeConfig } from '../../config/globe';
import { uvToLatLon } from '../../lib/geo';

type Props = {
  onPick: (lat: number, lon: number) => void;
  onHover: (p: { lat: number; lon: number; x: number; y: number } | null) => void;
  interactive: boolean;
};

/** Blue Marble sphere: colour map + topology bump + water-mask specular. Radius 1. */
export function Earth({ onPick, onHover, interactive }: Props) {
  const { color, bump, water } = globeConfig.textures;
  const [map, bumpMap, specularMap] = useTexture([color, bump, water]);
  const gl = useThree((s) => s.gl);

  useLayoutEffect(() => {
    map.colorSpace = SRGBColorSpace;
    const aniso = gl.capabilities.getMaxAnisotropy();
    [map, bumpMap, specularMap].forEach((t) => {
      t.anisotropy = Math.min(8, aniso);
      t.needsUpdate = true;
    });
  }, [map, bumpMap, specularMap, gl]);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    // e.delta = px moved between pointerdown and up; anything bigger was a drag, not a pick.
    if (!interactive || e.delta > globeConfig.clickTolerancePx || !e.uv) return;
    e.stopPropagation();
    const { lat, lon } = uvToLatLon(e.uv.x, e.uv.y);
    onPick(lat, lon);
  };

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    if (!interactive || !e.uv) return;
    const { lat, lon } = uvToLatLon(e.uv.x, e.uv.y);
    onHover({ lat, lon, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
  };

  return (
    <mesh
      onClick={handleClick}
      onPointerMove={handleMove}
      onPointerOut={() => onHover(null)}
    >
      <sphereGeometry args={[1, 128, 64]} />
      <meshPhongMaterial
        map={map}
        bumpMap={bumpMap}
        bumpScale={globeConfig.bumpScale}
        specularMap={specularMap}
        specular={new Color('#4a6a90')}
        shininess={globeConfig.shininess}
      />
    </mesh>
  );
}
