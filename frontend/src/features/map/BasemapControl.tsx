import type { IControl } from 'maplibre-gl';
import { createPortal } from 'react-dom';
import { basemapOrder, basemaps } from '../../config/map';
import { useLayers } from '../layers/layerStore';

/** A maplibre control slot we can portal React into (keeps it stacked with zoom/attribution). */
export class PortalControl implements IControl {
  el = document.createElement('div');
  constructor(className: string) {
    this.el.className = `maplibregl-ctrl ${className}`;
  }
  onAdd() {
    return this.el;
  }
  onRemove() {
    this.el.remove();
  }
}

/** One real tile of each basemap as its thumbnail (z4: the Adriatic and the Alps, land and sea in one square). */
const THUMB_TILE = { z: 4, x: 8, y: 5 };
const thumbUrl = (id: keyof typeof basemaps) => {
  const b = basemaps[id].base[0];
  return b.url
    .replace('{z}', String(Math.min(THUMB_TILE.z, b.maxzoom ?? THUMB_TILE.z)))
    .replace('{x}', String(THUMB_TILE.x))
    .replace('{y}', String(THUMB_TILE.y))
    .replace('{s}', 'a');
};

/** Satellite / Map / Blue Marble switcher. */
export function BasemapSwitcher({ host }: { host: HTMLElement }) {
  const basemap = useLayers((s) => s.basemap);
  const set = useLayers((s) => s.set);
  return createPortal(
    <div className="basemap-switch" role="radiogroup" aria-label="Base map">
      {basemapOrder.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={basemap === id}
          className={`basemap-switch__opt basemap-switch__opt--${id}`}
          onClick={() => set({ basemap: id })}
        >
          <span className="basemap-switch__thumb" style={{ backgroundImage: `url("${thumbUrl(id)}")` }} aria-hidden />
          {basemaps[id].label}
        </button>
      ))}
    </div>,
    host,
  );
}
