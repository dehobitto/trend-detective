import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { CanvasTexture, ShaderMaterial, SRGBColorSpace, Texture, TextureLoader } from 'three';
import type { GibsLayer } from '../../api/types';
import { globeConfig } from '../../config/globe';
import { useReducedMotion } from '../../config/motion';
import { useSelectedVariable, useStore } from '../../state/store';
import { neighbourFrames } from '../layers/frames';
import { useLayers } from '../layers/layerStore';
import { globeUniforms } from './sun';

const cfg = globeConfig.overlay;

/** GIBS WMS (EPSG:4326) as one equirectangular image: lon -180..180 left to right, lat 90 at the top (API.md v3). */
export function gibsWmsUrl(l: GibsLayer, date: string): string {
  const p = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.3.0',
    LAYERS: l.layer,
    STYLES: '',
    CRS: 'EPSG:4326',
    BBOX: '-90,-180,90,180',
    WIDTH: String(cfg.wmsWidth),
    HEIGHT: String(cfg.wmsWidth / 2),
    FORMAT: 'image/png',
    TRANSPARENT: 'TRUE',
    TIME: date,
  });
  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${p}`;
}

type Loaded = { tex: Texture };
type Job = { key: string; load: () => Promise<Loaded> };

/** What the overlay should show right now (null = nothing), plus the frames around it to preload, nearest first. */
function jobsFor(s: ReturnType<typeof useLayers.getState>): { now: Job | null; next: Job[] } {
  const { layer, variableId, date, frames } = s;
  if (!layer || !variableId) return { now: null, next: [] };
  const at = (d: string | null | undefined): Job | null => (d ? { key: `gibs|${layer.layer}|${d}`, load: () => loadImage(gibsWmsUrl(layer, d)) } : null);
  const around = neighbourFrames(frames, date, cfg.prefetch, cfg.prefetch).map(at).filter((j): j is Job => !!j);
  return { now: at(date), next: around };
}

const loader = new TextureLoader().setCrossOrigin('anonymous');
function loadImage(url: string): Promise<Loaded> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = SRGBColorSpace;
        resolve({ tex });
      },
      undefined,
      () => reject(new Error('No image for this date')),
    );
  });
}

/** Small LRU of loaded textures (current, previous and the preloaded next frames). */
const cache = new Map<string, Promise<Loaded>>();
function get(job: Job, inUse: Set<Texture>): Promise<Loaded> {
  let p = cache.get(job.key);
  if (p) {
    cache.delete(job.key);
    cache.set(job.key, p);
    return p;
  }
  p = job.load();
  p.catch(() => cache.delete(job.key));
  cache.set(job.key, p);
  while (cache.size > cfg.cacheSize) {
    const [k, old] = cache.entries().next().value!;
    cache.delete(k);
    old.then((l) => !inUse.has(l.tex) && l.tex.dispose()).catch(() => {});
  }
  return p;
}

const vertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  void main() {
    vUv = uv;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`;
const fragment = /* glsl */ `
  uniform sampler2D uA;
  uniform sampler2D uB;
  uniform float uMix;
  uniform float uOpacity;
  uniform float uLandOnly;
  uniform sampler2D uWater;
  uniform vec3 uSun;
  varying vec2 vUv;
  varying vec3 vN;
  void main() {
    vec4 a = texture2D(uA, vUv);
    vec4 b = texture2D(uB, vUv);
    vec4 c = mix(a, b, uMix);
    // Mostly flat colour (it's data, not terrain), with a hint of the sun so the globe still reads as round.
    float light = 0.72 + 0.28 * smoothstep(-0.2, 0.6, dot(normalize(vN), uSun));
    // Land-only variables follow the real coastline (cuts GIBS' low-res coastal fringe).
    float land = 1.0 - smoothstep(0.35, 0.65, texture2D(uWater, vUv).r);
    float mask = mix(1.0, land, uLandOnly);
    gl_FragColor = vec4(c.rgb * light, c.a * uOpacity * mask);
    #include <colorspace_fragment>
  }
`;

/**
 * The selected variable draped over the globe: a sphere just above the ground (below the clouds, which
 * fade out while it's shown): the variable's NASA GIBS WMS equirectangular image for the timeline date.
 * New frames cross-fade in once loaded; the next timeline frame is preloaded.
 */
export function GlobeOverlay() {
  const reduced = useReducedMotion();
  const view = useStore((s) => s.view);
  const landOnly = useSelectedVariable()?.coverage === 'land';
  const water = useTexture(globeConfig.textures.water);
  const empty = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    return new CanvasTexture(c);
  }, []);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: { uA: { value: empty }, uB: { value: empty }, uMix: { value: 1 }, uOpacity: { value: 0 }, uLandOnly: { value: 0 }, uWater: { value: water }, uSun: globeUniforms.uSun },
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    [empty, water],
  );
  material.uniforms.uLandOnly.value = landOnly ? 1 : 0;
  const shownKey = useRef<string | null>(null);
  const fade = useRef<{ t0: number } | null>(null);
  const visible = useRef(0); // 0..1 overall fade of the overlay (and inverse for clouds)
  const wantVisible = useRef(false);
  const inUse = useRef(new Set<Texture>());

  useEffect(() => {
    if (view !== 'globe') return; // the map draws its own overlay; don't fetch for a hidden globe
    let seq = 0;
    const sync = () => {
      const s = useLayers.getState();
      const { now, next } = jobsFor(s);
      if (!now || !s.overlayOn) {
        wantVisible.current = false;
        if (!now) shownKey.current = null;
        return;
      }
      wantVisible.current = true;
      if (now.key === shownKey.current) return;
      const my = ++seq;
      s.set({ loading: true });
      get(now, inUse.current)
        .then(({ tex }) => {
          if (my !== seq) return;
          const u = material.uniforms;
          // Cross-fade from what's on screen (B) to the new frame.
          u.uA.value = shownKey.current ? u.uB.value : tex;
          u.uB.value = tex;
          u.uMix.value = shownKey.current && !reduced ? 0 : 1;
          fade.current = u.uMix.value < 1 ? { t0: performance.now() } : null;
          inUse.current = new Set([u.uA.value, u.uB.value]);
          shownKey.current = now.key;
          useLayers.getState().set({ loading: false, frameMissing: false, overlayError: null });
          // Preload neighbours one after another (big images: don't compete with the frame on screen).
          next.reduce<Promise<unknown>>((chain, j) => chain.then((): unknown => (my === seq ? get(j, inUse.current) : null)).catch(() => {}), Promise.resolve());
        })
        .catch(() => {
          if (my !== seq) return;
          useLayers.getState().set({ loading: false, frameMissing: true });
        });
    };
    sync();
    const unsub = useLayers.subscribe((s, p) => {
      if (
        s.layer !== p.layer ||
        s.variableId !== p.variableId ||
        s.overlayOn !== p.overlayOn ||
        s.date !== p.date
      )
        sync();
    });
    return () => {
      seq++;
      unsub();
    };
  }, [view, material, reduced]);

  useFrame((_, dt) => {
    const step = reduced ? 1 : Math.min(dt, 0.1) / (cfg.showFadeMs / 1000);
    const target = wantVisible.current && shownKey.current ? 1 : 0;
    visible.current = target > visible.current ? Math.min(target, visible.current + step) : Math.max(target, visible.current - step);
    const f = fade.current;
    if (f) {
      const t = Math.min(1, (performance.now() - f.t0) / cfg.crossFadeMs);
      material.uniforms.uMix.value = t;
      if (t >= 1) fade.current = null;
    }
    // The map picture draped during the hand-off already carries the layer: fade this copy out meanwhile.
    material.uniforms.uOpacity.value = visible.current * useLayers.getState().opacity * (1 - globeUniforms.uHandoff.value);
    globeUniforms.uCloudAlpha.value = 1 - visible.current * (1 - cfg.cloudAlphaWithOverlay);
  });

  return (
    <mesh material={material} scale={cfg.altitude} raycast={() => null} renderOrder={0.5}>
      <sphereGeometry args={[1, 160, 80]} />
    </mesh>
  );
}
