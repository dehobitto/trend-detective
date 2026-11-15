import type { GridFrame, TrendGrid } from '../../api/types';
import { buildLut } from './frames';

/** Opacity (0..255) of cells whose trend is not significant, and their hatch lines. */
const WEAK_ALPHA = 84;
const HATCH_ALPHA = 130;
const HATCH_PERIOD_PX = 7;

const isTrend = (f: GridFrame): f is TrendGrid => Array.isArray((f as TrendGrid).significant);

/**
 * Paint a GridFrame / TrendGrid onto `canvas` (W x H px). `latOfRow(j)` maps a canvas row (centre, 0..H)
 * to its latitude, so the same code draws Web-Mercator images for the map and equirectangular textures
 * for the globe. Values are bilinear-interpolated; no-data cells stay transparent. Trend cells that are
 * not significant are drawn faint with thin diagonal hatching, so "real" change stands out.
 */
export function paintGrid(
  f: GridFrame,
  canvas: HTMLCanvasElement,
  W: number,
  H: number,
  latOfRow: (j: number) => number,
  /** Paint a pixel if any neighbouring cell has data (the globe masks coasts with its own water map). */
  fillEdges = false,
) {
  const minW = fillEdges ? 1e-6 : 0.5;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const px = img.data;
  const lut = buildLut(f.colormap, f.min, f.max);
  const { width: gw, height: gh, values } = f;
  const sig = isTrend(f) ? f.significant : null;
  const latSpan = f.bbox.north - f.bbox.south;
  const scale = 255 / (f.max - f.min || 1);

  const c0 = new Int32Array(W);
  const c1 = new Int32Array(W);
  const cx = new Float32Array(W);
  for (let i = 0; i < W; i++) {
    const fc = Math.max(0, Math.min(gw - 1, ((i + 0.5) / W) * gw - 0.5));
    c0[i] = Math.floor(fc);
    c1[i] = Math.min(gw - 1, c0[i] + 1);
    cx[i] = fc - c0[i];
  }
  for (let j = 0; j < H; j++) {
    const lat = latOfRow(j + 0.5);
    const fr = Math.max(0, Math.min(gh - 1, ((f.bbox.north - lat) / latSpan) * gh - 0.5));
    const r0 = Math.floor(fr);
    const r1 = Math.min(gh - 1, r0 + 1);
    const ty = fr - r0;
    for (let i = 0; i < W; i++) {
      const tx = cx[i];
      let sum = 0;
      let wsum = 0;
      const add = (v: number | null | undefined, w: number) => {
        if (v !== null && v !== undefined && Number.isFinite(v)) {
          sum += v * w;
          wsum += w;
        }
      };
      add(values[r0 * gw + c0[i]], (1 - tx) * (1 - ty));
      add(values[r0 * gw + c1[i]], tx * (1 - ty));
      add(values[r1 * gw + c0[i]], (1 - tx) * ty);
      add(values[r1 * gw + c1[i]], tx * ty);
      const o = (j * W + i) * 4;
      if (wsum < minW) {
        px[o + 3] = 0;
        continue;
      }
      const k = Math.max(0, Math.min(255, Math.round((sum / wsum - f.min) * scale))) * 3;
      px[o] = lut[k];
      px[o + 1] = lut[k + 1];
      px[o + 2] = lut[k + 2];
      let a = 255;
      if (sig) {
        // Share of significant cells around this pixel (bilinear), so the mask edges are smooth too.
        const s =
          (sig[r0 * gw + c0[i]] ? (1 - tx) * (1 - ty) : 0) +
          (sig[r0 * gw + c1[i]] ? tx * (1 - ty) : 0) +
          (sig[r1 * gw + c0[i]] ? (1 - tx) * ty : 0) +
          (sig[r1 * gw + c1[i]] ? tx * ty : 0);
        const k2 = Math.max(0, Math.min(1, (s - 0.3) / 0.4));
        const weak = s < 0.5 && (i + j) % HATCH_PERIOD_PX === 0 ? HATCH_ALPHA : WEAK_ALPHA;
        a = Math.round(weak + (255 - weak) * k2);
      }
      px[o + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Global equirectangular texture (row 0 = 90°N, last row = 90°S) for the globe overlay. */
export function paintEquirect(f: GridFrame, canvas: HTMLCanvasElement, width = 1024, fillEdges = false) {
  const H = width / 2;
  paintGrid(f, canvas, width, H, (y) => 90 - (y / H) * 180, fillEdges);
}
