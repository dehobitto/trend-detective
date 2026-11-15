import { useTexture } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo } from 'react';
import { Color, LinearSRGBColorSpace, RepeatWrapping, SRGBColorSpace, ShaderMaterial, Vector2 } from 'three';
import { colors } from '../../config/colors';
import { globeConfig } from '../../config/globe';
import { useReducedMotion } from '../../config/motion';
import { uvToLatLon } from '../../lib/geo';
import { sphereRaycast } from './sphereRaycast';
import { globeUniforms } from './sun';

type Props = {
  onPick: (lat: number, lon: number) => void;
  onHover: (p: { lat: number; lon: number; x: number; y: number } | null) => void;
  interactive: boolean;
};

const vertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vPos;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPos = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

/*
 * Day/night Earth in one pass:
 * - Blue Marble NG albedo, with the near-black ocean lifted to the blue it reads as from orbit;
 * - relief from the topography map, perturbing the normal in the local east/north frame;
 * - ocean glint (Blinn-Phong) from the water mask, dimmed under clouds;
 * - Black Marble city lights fading in across a soft terminator;
 * - cloud shadows from the same drifting cloud map the cloud shell uses;
 * - in-scattered blue haze towards the limb on the lit side.
 */
const earthFragment = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform sampler2D uBump;
  uniform sampler2D uWater;
  uniform sampler2D uClouds;
  uniform vec3 uSun;
  uniform vec3 uAtmo;
  uniform float uCloudShift;
  uniform float uCloudAlpha;
  uniform float uBumpScale;
  uniform float uExposure;
  uniform vec2 uTexel;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vPos;

  void main() {
    vec3 n = normalize(vN);
    vec3 V = normalize(cameraPosition - vPos);
    vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), n) + vec3(1e-5, 0.0, 0.0));
    vec3 north = cross(n, east);

    float water = texture2D(uWater, vUv).r;
    float land = 1.0 - water;

    // Relief: finite differences of the height map, land only.
    float h = texture2D(uBump, vUv).r;
    float hx = texture2D(uBump, vUv + vec2(uTexel.x, 0.0)).r;
    float hy = texture2D(uBump, vUv + vec2(0.0, uTexel.y)).r;
    vec3 bn = normalize(n - uBumpScale * land * ((hx - h) * east + (hy - h) * north));

    vec3 day = texture2D(uDay, vUv).rgb;
    // The BMNG ocean is almost black; from orbit the open sea reads as deep blue.
    day = mix(day, day * vec3(0.8, 0.95, 1.2) + vec3(0.003, 0.011, 0.032), water);

    float cl = texture2D(uClouds, vUv + vec2(uCloudShift, 0.0)).r * uCloudAlpha;
    // Shadow sampled a touch away from the sun so it sits beside its cloud near the terminator.
    float clShadow = texture2D(uClouds, vUv + vec2(uCloudShift, 0.0) - 0.0015 * vec2(dot(uSun, east), dot(uSun, north))).r * uCloudAlpha;

    float ndl = dot(bn, uSun);
    float geo = dot(n, uSun);
    float dayMix = smoothstep(-0.18, 0.18, geo);
    // Lambert with a flattened peak: the subsolar point should not read as a hotspot.
    float diffuse = pow(max(ndl, 0.0), 0.75) * 0.92;
    // Wrap a little light past the terminator: twilight, not a hard cut.
    float twilight = smoothstep(-0.2, 0.12, geo) * 0.06;

    vec3 col = day * (diffuse * 1.08 + twilight + 0.012) * (1.0 - 0.42 * clShadow);

    // Ocean glint: a tight sun reflection plus a broad sheen.
    vec3 H = normalize(uSun + V);
    float nh = max(dot(n, H), 0.0);
    float glint = (pow(nh, 220.0) * 0.9 + pow(nh, 24.0) * 0.045) * water * (1.0 - cl) * smoothstep(0.0, 0.2, geo);
    col += vec3(1.0, 0.94, 0.82) * glint;

    // City lights on the night side.
    vec3 night = max(texture2D(uNight, vUv).rgb - 0.035, 0.0);
    col += night * vec3(1.0, 0.78, 0.48) * 2.2 * (1.0 - dayMix) * (1.0 - 0.7 * cl);

    // Atmospheric in-scattering: thicker path towards the limb, only where the air is sunlit.
    float mu = max(dot(n, V), 0.0);
    float limb = pow(1.0 - mu, 3.0);
    float lit = smoothstep(-0.3, 0.5, geo);
    col = mix(col, uAtmo * (0.55 + 0.45 * lit), limb * 0.75 * lit);
    col += uAtmo * 0.035 * lit;

    col = 1.0 - exp(-col * uExposure);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const cloudFragment = /* glsl */ `
  uniform sampler2D uClouds;
  uniform vec3 uSun;
  uniform vec3 uAtmo;
  uniform float uCloudShift;
  uniform float uCloudAlpha;
  uniform float uExposure;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vPos;
  void main() {
    vec3 n = normalize(vN);
    vec3 V = normalize(cameraPosition - vPos);
    float cl = texture2D(uClouds, vUv + vec2(uCloudShift, 0.0)).r;
    float geo = dot(n, uSun);
    float light = smoothstep(-0.15, 0.35, geo) * (0.25 + 0.75 * max(geo, 0.0)) + 0.02;
    vec3 col = vec3(1.0) * light;
    float limb = pow(1.0 - max(dot(n, V), 0.0), 3.0);
    col = mix(col, uAtmo, limb * 0.5 * smoothstep(-0.3, 0.5, geo));
    col = 1.0 - exp(-col * uExposure);
    // Thin cloud is see-through; thick cloud is opaque.
    float a = clamp(cl * 1.2, 0.0, 0.95) * uCloudAlpha;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

/** Earth sphere (radius 1) plus a slowly drifting cloud shell. Clicks and hover read the Earth's UVs. */
export function Earth({ onPick, onHover, interactive }: Props) {
  const t = globeConfig.textures;
  const [day, night, bump, water, clouds] = useTexture([t.day, t.night, t.bump, t.water, t.clouds]);
  const gl = useThree((s) => s.gl);
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy());
    day.colorSpace = SRGBColorSpace;
    night.colorSpace = SRGBColorSpace;
    [bump, water, clouds].forEach((x) => (x.colorSpace = LinearSRGBColorSpace));
    clouds.wrapS = RepeatWrapping;
    [day, night, bump, water, clouds].forEach((x) => {
      x.anisotropy = aniso;
      x.needsUpdate = true;
    });
  }, [day, night, bump, water, clouds, gl]);

  const [earthMat, cloudMat] = useMemo(() => {
    const atmo = { value: new Color(colors.atmosphere) };
    const exposure = { value: globeConfig.exposure };
    const earthMat = new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: earthFragment,
      uniforms: {
        uDay: { value: day },
        uNight: { value: night },
        uBump: { value: bump },
        uWater: { value: water },
        uClouds: { value: clouds },
        uSun: globeUniforms.uSun,
        uCloudShift: globeUniforms.uCloudShift,
        uCloudAlpha: globeUniforms.uCloudAlpha,
        uAtmo: atmo,
        uBumpScale: { value: globeConfig.bumpScale },
        uExposure: exposure,
        uTexel: { value: new Vector2(1 / 4096, 1 / 2048) },
      },
      toneMapped: false,
    });
    const cloudMat = new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: cloudFragment,
      uniforms: {
        uClouds: { value: clouds },
        uSun: globeUniforms.uSun,
        uCloudShift: globeUniforms.uCloudShift,
        uCloudAlpha: globeUniforms.uCloudAlpha,
        uAtmo: atmo,
        uExposure: exposure,
      },
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    return [earthMat, cloudMat];
  }, [day, night, bump, water, clouds]);

  // Clouds drift eastward, one full turn in cloudPeriodS (stopped for reduced motion).
  useFrame((_, dt) => {
    if (reduced) return;
    globeUniforms.uCloudShift.value = (globeUniforms.uCloudShift.value - Math.min(dt, 0.1) / globeConfig.cloudPeriodS) % 1;
  });

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
    <>
      <mesh material={earthMat} raycast={sphereRaycast} onClick={handleClick} onPointerMove={handleMove} onPointerOut={() => onHover(null)}>
        <sphereGeometry args={[1, 160, 80]} />
      </mesh>
      <mesh material={cloudMat} scale={globeConfig.cloudAltitude} raycast={() => null} renderOrder={1}>
        <sphereGeometry args={[1, 128, 64]} />
      </mesh>
    </>
  );
}
