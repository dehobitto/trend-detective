import { useMemo } from 'react';
import { ShaderMaterial } from 'three';
import { globeConfig } from '../../config/globe';
import { globeUniforms } from './sun';

const vertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  void main() {
    vUv = uv;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`;

/**
 * Hairline latitude/longitude grid every `uStep` degrees; the equator and prime meridian a little
 * stronger. Lines are antialiased in screen space (fwidth) so they stay one pixel wide at any zoom,
 * and meridians stop short of the poles where they would bunch up.
 */
const fragment = /* glsl */ `
  uniform float uStep;
  uniform float uAlpha;
  uniform float uHandoff;
  uniform float uGrid;
  uniform vec3 uSun;
  varying vec2 vUv;
  varying vec3 vN;
  float lineAt(float x, float step, float w) {
    float d = abs(fract(x / step - 0.5) - 0.5) * step;
    return 1.0 - smoothstep(0.0, w * 1.2, d);
  }
  void main() {
    float lon = vUv.x * 360.0 - 180.0;
    float lat = vUv.y * 180.0 - 90.0;
    vec2 w = vec2(fwidth(lon), fwidth(lat));
    w.x = min(w.x, 2.0); // the texture seam jumps by 360 degrees: don't smear a line along it
    float meridian = lineAt(lon, uStep, w.x) * (1.0 - smoothstep(70.0, 80.0, abs(lat)));
    float parallel = lineAt(lat, uStep, w.y);
    float g = max(meridian, parallel);
    float main = max(1.0 - smoothstep(0.0, w.y * 1.2, abs(lat)), 1.0 - smoothstep(0.0, w.x * 1.2, abs(lon)));
    float lit = 0.45 + 0.55 * smoothstep(-0.2, 0.3, dot(normalize(vN), uSun));
    float a = max(g * uAlpha, main * uAlpha * 1.8) * lit * (1.0 - uHandoff) * uGrid;
    gl_FragColor = vec4(vec3(1.0), a);
  }
`;

export function Graticule() {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: { uStep: { value: globeConfig.graticule.stepDeg }, uAlpha: { value: globeConfig.graticule.alpha }, uSun: globeUniforms.uSun, uHandoff: globeUniforms.uHandoff, uGrid: globeUniforms.uGrid },
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  return (
    <mesh material={material} scale={globeConfig.graticule.altitude} raycast={() => null} renderOrder={1.5}>
      <sphereGeometry args={[1, 160, 80]} />
    </mesh>
  );
}
