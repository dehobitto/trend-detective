import type { IControl } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
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

/** Satellite / Map / Blue Marble: one thumbnail button showing the current style; it opens a menu of the others. */
export function BasemapSwitcher({ host }: { host: HTMLElement }) {
  const basemap = useLayers((s) => s.basemap);
  const set = useLayers((s) => s.set);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  return createPortal(
    <div className="basemap-switch" ref={root}>
      <button
        type="button"
        className="basemap-switch__current"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Map style: ${basemaps[basemap].label}`}
        title={`Map style: ${basemaps[basemap].label}`}
        onClick={() => setOpen(!open)}
        style={{ backgroundImage: `url("${thumbUrl(basemap)}")` }}
      />
      {open && (
        <div className="basemap-switch__menu" role="menu" aria-label="Map style">
          {basemapOrder.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitemradio"
              aria-checked={basemap === id}
              className="basemap-switch__opt"
              onClick={() => {
                set({ basemap: id });
                setOpen(false);
              }}
            >
              <span className="basemap-switch__thumb" style={{ backgroundImage: `url("${thumbUrl(id)}")` }} aria-hidden />
              {basemaps[id].label}
            </button>
          ))}
        </div>
      )}
    </div>,
    host,
  );
}
