import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { CanvasTexture, LinearFilter, ShaderMaterial, SRGBColorSpace, Texture, TextureLoader } from 'three';
import { api } from '../../api/client';
import type { GibsLayer, GridFrame } from '../../api/types';
import { globeConfig } from '../../config/globe';
import { useReducedMotion } from '../../config/motion';
import { useSelectedVariable, useStore } from '../../state/store';
import { paintEquirect } from '../layers/gridRender';
import { useLayers, usesGrid, type MapMode } from '../layers/layerStore';
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

type Loaded = { tex: Texture; frame: GridFrame | null };
type Job = { key: string; load: () => Promise<Loaded> };

/** What the overlay should show right now (null = nothing), plus the next frame to preload. */
function jobsFor(s: ReturnType<typeof useLayers.getState>): { now: Job | null; next: Job | null } {
  const { layer, variableId, mode, date, frames, trendPeriod } = s;
  if (!layer || !variableId) return { now: null, next: null };
  const at = (d: string | null | undefined): Job | null => {
    if (!d) return null;
    if (!usesGrid(s)) {
      const l = layer as GibsLayer;
      return { key: `gibs|${l.layer}|${d}`, load: () => loadImage(gibsWmsUrl(l, d)) };
    }
    return { key: `grid|${variableId}|${mode}|${d}`, load: () => loadGrid(variableId, mode, d) };
  };
  if (mode === 'trend') {
    if (!trendPeriod) return { now: null, next: null };
    const d = `${trendPeriod.start}/${trendPeriod.end}`;
    return { now: { key: `trend|${variableId}|${d}`, load: () => loadGrid(variableId, 'trend', d) }, next: null };
  }
  const i = date ? frames.indexOf(date) : -1;
  return { now: at(date), next: i >= 0 && frames.length > 1 ? at(frames[(i + 1) % frames.length]) : null };
}

const loader = new TextureLoader().setCrossOrigin('anonymous');
function loadImage(url: string): Promise<Loaded> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = SRGBColorSpace;
        resolve({ tex, frame: null });
      },
      undefined,
      () => reject(new Error('No image for this date')),
    );
  });
}

async function loadGrid(variableId: string, mode: MapMode, d: string): Promise<Loaded> {
  let frame: GridFrame;
  if (mode === 'trend') {
    const [start, end] = d.split('/');
    frame = await api.getTrendGrid(variableId, { start, end, res: cfg.gridRes });
  } else {
    frame = await api.getGrid(variableId, { date: d, res: cfg.gridRes, mode: mode === 'anomaly' ? 'anomaly' : 'value' });
  }
  const canvas = document.createElement('canvas');
  // Land-only variables: grow the data over the coarse coasts; the shader cuts them along the real coastline.
  paintEquirect(frame, canvas, cfg.canvasWidth, frame.values.some((v) => v === null));
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  return { tex, frame };
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
    // Land-only variables follow the real coastline (the data grid is ~2° coarse).
    float land = 1.0 - smoothstep(0.35, 0.65, texture2D(uWater, vUv).r);
    float mask = mix(1.0, land, uLandOnly);
    gl_FragColor = vec4(c.rgb * light, c.a * uOpacity * mask);
    #include <colorspace_fragment>
  }
`;

/**
 * The selected variable draped over the globe: a sphere just above the ground (below the clouds, which
 * fade out while it's shown). Value mode with GIBS imagery uses the WMS equirectangular image for the
 * timeline date; grid / anomaly / trend modes paint a global GridFrame or TrendGrid onto a canvas.
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
        .then(({ tex, frame }) => {
          if (my !== seq) return;
          const u = material.uniforms;
          // Cross-fade from what's on screen (B) to the new frame.
          u.uA.value = shownKey.current ? u.uB.value : tex;
          u.uB.value = tex;
          u.uMix.value = shownKey.current && !reduced ? 0 : 1;
          fade.current = u.uMix.value < 1 ? { t0: performance.now() } : null;
          inUse.current = new Set([u.uA.value, u.uB.value]);
          shownKey.current = now.key;
          useLayers.getState().set({
            loading: false,
            frameMissing: false,
            overlayError: null,
            ...(frame
              ? {
                  gridLegend: {
                    min: frame.min,
                    max: frame.max,
                    units: frame.units,
                    colormap: frame.colormap,
                    synthetic: frame.synthetic,
                    diverging: frame.min < 0 && Math.abs(frame.min + frame.max) < 1e-9,
                  },
                }
              : {}),
          });
          if (next) get(next, inUse.current).catch(() => {});
        })
        .catch((e) => {
          if (my !== seq) return;
          const imagery = !usesGrid(useLayers.getState());
          useLayers.getState().set(
            imagery ? { loading: false, frameMissing: true } : { loading: false, overlayError: `Could not load the map layer: ${e instanceof Error ? e.message : 'error'}` },
          );
        });
    };
    sync();
    const unsub = useLayers.subscribe((s, p) => {
      if (
        s.layer !== p.layer ||
        s.variableId !== p.variableId ||
        s.mode !== p.mode ||
        s.overlayOn !== p.overlayOn ||
        (s.mode !== 'trend' && s.date !== p.date) ||
        s.trendPeriod?.start !== p.trendPeriod?.start ||
        s.trendPeriod?.end !== p.trendPeriod?.end
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
    material.uniforms.uOpacity.value = visible.current * useLayers.getState().opacity;
    globeUniforms.uCloudAlpha.value = 1 - visible.current * (1 - cfg.cloudAlphaWithOverlay);
  });

  return (
    <mesh material={material} scale={cfg.altitude} raycast={() => null} renderOrder={0.5}>
      <sphereGeometry args={[1, 160, 80]} />
    </mesh>
  );
}
