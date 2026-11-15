import { useMemo } from 'react';
import { BackSide, Color, ShaderMaterial } from 'three';
import { colors } from '../../config/colors';
import { globeConfig } from '../../config/globe';
import { globeUniforms } from './sun';

const vertex = /* glsl */ `
  varying vec3 vN;
  varying vec3 vPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPos = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

/**
 * The thin blue limb seen beyond the Earth's edge. Drawn as the back faces of a slightly larger shell:
 * densest right at the surface, gone by the shell's edge, brighter where the air is sunlit.
 * Normal (not additive) blending, so it reads as blue on the light page rather than vanishing into it.
 */
const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSun;
  uniform float uLimb;
  uniform float uStrength;
  uniform float uHandoff;
  varying vec3 vN;
  varying vec3 vPos;
  void main() {
    vec3 n = normalize(vN);
    vec3 V = normalize(cameraPosition - vPos);
    // 0 at the shell's silhouette, 1 where the line of sight grazes the Earth's surface.
    float f = clamp(-dot(n, V) / uLimb, 0.0, 1.0);
    float density = pow(f, 3.5);
    float lit = smoothstep(-0.35, 0.45, dot(n, uSun));
    float a = density * uStrength * (0.35 + 0.65 * lit) * (1.0 - 0.85 * uHandoff);
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

export function Atmosphere() {
  const scale = globeConfig.atmosphereScale;
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          uColor: { value: new Color(colors.atmosphere) },
          uSun: globeUniforms.uSun,
          uLimb: { value: Math.sqrt(1 - 1 / (scale * scale)) },
          uStrength: { value: globeConfig.atmosphereStrength },
          uHandoff: globeUniforms.uHandoff,
        },
        side: BackSide,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    [scale],
  );

  return (
    <mesh material={material} scale={scale} raycast={() => null} renderOrder={2}>
      <sphereGeometry args={[1, 128, 64]} />
    </mesh>
  );
}
