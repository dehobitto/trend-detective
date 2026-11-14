import { useMemo } from 'react';
import { AdditiveBlending, BackSide, Color, FrontSide, ShaderMaterial } from 'three';
import { colors } from '../../config/colors';
import { globeConfig } from '../../config/globe';

const vertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

/** Outer halo: brightest at Earth's limb, fading smoothly to nothing at the shell's edge. */
const haloFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uLimb;
  uniform float uStrength;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    float f = clamp(-dot(vNormal, vViewDir), 0.0, 1.0);
    float g = smoothstep(0.0, uLimb, f);
    float glow = pow(g, 2.4) * uStrength;
    gl_FragColor = vec4(uColor * glow, glow);
  }
`;

/** Inner rim: a thin fresnel haze on the Earth's own surface near the edge. */
const rimFragment = /* glsl */ `
  uniform vec3 uColor;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    float fres = 1.0 - clamp(dot(vNormal, vViewDir), 0.0, 1.0);
    float rim = pow(fres, 3.2) * 0.95;
    gl_FragColor = vec4(uColor * rim, rim);
  }
`;

export function Atmosphere() {
  const scale = globeConfig.atmosphereScale;
  const [halo, rim] = useMemo(() => {
    const color = new Color(colors.atmosphere);
    const halo = new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: haloFragment,
      uniforms: {
        uColor: { value: color },
        uLimb: { value: Math.sqrt(1 - 1 / (scale * scale)) },
        uStrength: { value: globeConfig.atmosphereStrength },
      },
      side: BackSide,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const rim = new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: rimFragment,
      uniforms: { uColor: { value: color } },
      side: FrontSide,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    return [halo, rim];
  }, [scale]);

  return (
    <>
      <mesh material={rim} raycast={() => null}>
        <sphereGeometry args={[1.003, 96, 48]} />
      </mesh>
      <mesh material={halo} scale={scale} raycast={() => null}>
        <sphereGeometry args={[1, 96, 48]} />
      </mesh>
    </>
  );
}
