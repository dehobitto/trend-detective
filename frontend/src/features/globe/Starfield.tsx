import { useTexture } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  type Group,
  MeshBasicMaterial,
  ShaderMaterial,
  SRGBColorSpace,
} from 'three';
import { globeConfig } from '../../config/globe';
import { latLonToVector3 } from '../../lib/geo';
import { gmstDeg } from './sun';

const RAD = Math.PI / 180;
const SKY_R = 80;

/** Crisp round stars, sized and tinted by brightness (screen-space size, so they stay sharp at any zoom). */
const starVertex = /* glsl */ `
  attribute float aB;
  attribute vec3 aTint;
  uniform float uScale;
  varying float vB;
  varying vec3 vTint;
  void main() {
    vB = aB;
    vTint = aTint;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = (0.9 + 2.6 * pow(aB, 1.4)) * uScale;
  }
`;
const starFragment = /* glsl */ `
  uniform float uBrightness;
  varying float vB;
  varying vec3 vTint;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    float core = exp(-r2 * 4.0);
    // Mostly white, a hint of each star's real colour.
    vec3 col = mix(vec3(1.0), vTint, 0.35);
    gl_FragColor = vec4(col, core * (0.25 + 0.75 * vB) * uBrightness);
  }
`;

type StarData = { stars: number[] };

/**
 * The night sky behind the globe, built from NASA SVS "Deep Star Maps 2020" (public domain):
 * - the 4500 brightest real stars as crisp points (positions, brightness and colour extracted from the 8k map),
 * - a faint, soft Milky Way glow (the map's diffuse light only, stars removed).
 * A camera-centred sky (no parallax), oriented by the Earth's axis and turned by sidereal time, so with live
 * sunlight the constellations stand where they really are over the Earth.
 */
export function Starfield() {
  const glowMap = useTexture(globeConfig.textures.milkyWay);
  const camera = useThree((s) => s.camera);
  const dpr = useThree((s) => s.viewport.dpr);
  const sky = useRef<Group>(null);
  const [data, setData] = useState<StarData | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(globeConfig.textures.stars)
      .then((r) => r.json())
      .then((d: StarData) => alive && setData(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useLayoutEffect(() => {
    glowMap.colorSpace = SRGBColorSpace;
    glowMap.needsUpdate = true;
  }, [glowMap]);

  const glowMaterial = useMemo(
    () => new MeshBasicMaterial({ map: glowMap, color: new Color().setScalar(globeConfig.milkyWayBrightness), side: DoubleSide, depthWrite: false, toneMapped: false }),
    [glowMap],
  );

  const stars = useMemo(() => {
    if (!data) return null;
    const n = data.stars.length / 6;
    const pos = new Float32Array(n * 3);
    const b = new Float32Array(n);
    const tint = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const [ra, dec, br, r, g, bl] = data.stars.slice(i * 6, i * 6 + 6);
      // RA α at longitude α in the sky frame; the group's rotation (−GMST) puts it over the right place on Earth.
      const v = latLonToVector3(dec, ra, SKY_R);
      pos.set([v.x, v.y, v.z], i * 3);
      b[i] = br;
      tint.set([r, g, bl], i * 3);
    }
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(pos, 3));
    geom.setAttribute('aB', new BufferAttribute(b, 1));
    geom.setAttribute('aTint', new BufferAttribute(tint, 3));
    const mat = new ShaderMaterial({
      vertexShader: starVertex,
      fragmentShader: starFragment,
      uniforms: { uScale: { value: dpr }, uBrightness: { value: globeConfig.starBrightness } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    return { geom, mat };
  }, [data, dpr]);

  useFrame(() => {
    const g = sky.current;
    if (!g) return;
    g.position.copy(camera.position);
    g.rotation.y = -gmstDeg(Date.now()) * RAD;
  });

  return (
    <group ref={sky} renderOrder={-1}>
      {/* The glow texture is a map seen from outside: mirror it (scale.z = -1) so RA increases eastward like the stars. */}
      <mesh material={glowMaterial} scale={[SKY_R * 1.05, SKY_R * 1.05, -SKY_R * 1.05]} renderOrder={-2} frustumCulled={false} raycast={() => null}>
        <sphereGeometry args={[1, 64, 32]} />
      </mesh>
      {stars && <points geometry={stars.geom} material={stars.mat} renderOrder={-1} frustumCulled={false} raycast={() => null} />}
    </group>
  );
}
