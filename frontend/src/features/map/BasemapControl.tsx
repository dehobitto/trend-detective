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
          <span className="basemap-switch__thumb" aria-hidden />
          {basemaps[id].label}
        </button>
      ))}
    </div>,
    host,
  );
}
