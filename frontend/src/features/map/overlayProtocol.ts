import maplibregl from 'maplibre-gl';

/**
 * GIBS serves "no data" overlay tiles (e.g. Reference_Labels_15m over empty areas) as an opaque
 * all-black palette PNG with no transparency. Drawn on top of the basemap they black out whole
 * tiles. This protocol fetches overlay tiles and swaps any all-black tile for a transparent one.
 * Use it by prefixing a tile URL with `gibs-overlay://` instead of `https://`.
 */
export const OVERLAY_PROTOCOL = 'gibs-overlay';

let registered = false;
let emptyTile: Promise<ArrayBuffer> | null = null;

/** A 256x256 fully transparent PNG, built once. Callers get a copy (maplibre may transfer the buffer). */
async function transparentTile(): Promise<ArrayBuffer> {
  emptyTile ??= (async () => {
    const c = new OffscreenCanvas(256, 256);
    c.getContext('2d'); // convertToBlob needs a context
    return (await c.convertToBlob({ type: 'image/png' })).arrayBuffer();
  })();
  return (await emptyTile).slice(0);
}

function isAllBlack(bitmap: ImageBitmap): boolean {
  const c = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(bitmap, 0, 0);
  const d = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] !== 0 && (d[i] | d[i + 1] | d[i + 2]) !== 0) return false;
  }
  return true;
}

export function registerOverlayProtocol() {
  if (registered || typeof OffscreenCanvas === 'undefined') return;
  registered = true;
  maplibregl.addProtocol(OVERLAY_PROTOCOL, async (params, abort) => {
    const url = params.url.replace(`${OVERLAY_PROTOCOL}://`, 'https://');
    try {
      const res = await fetch(url, { signal: abort.signal });
      if (!res.ok) return { data: await transparentTile() }; // GIBS sometimes 500s on empty tiles
      const buf = await res.arrayBuffer();
      const bitmap = await createImageBitmap(new Blob([buf]));
      const black = isAllBlack(bitmap);
      bitmap.close();
      return { data: black ? await transparentTile() : buf };
    } catch (e) {
      if (abort.signal.aborted) throw e;
      return { data: await transparentTile() };
    }
  });
}

/** Rewrite an https tile URL to go through the overlay protocol (when available). */
export function overlayUrl(url: string): string {
  return typeof OffscreenCanvas === 'undefined' ? url : url.replace(/^https:\/\//, `${OVERLAY_PROTOCOL}://`);
}
