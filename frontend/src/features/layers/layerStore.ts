import { create } from 'zustand';
import type { BBox, MapLayer } from '../../api/types';
import { mapConfig, type BasemapId } from '../../config/map';

/** One-shot camera request for the map (search result, "use this area"). */
export type MapCommand = { nonce: number; center: { lat: number; lon: number }; zoom?: number; bounds?: BBox | null };

type LayerState = {
  /** The selected variable's GIBS imagery layer (null = nothing to show) and its timeline frames. */
  variableId: string | null;
  layer: MapLayer | null;
  frames: string[];

  basemap: BasemapId;
  /** Variable overlay on/off and opacity. */
  overlayOn: boolean;
  opacity: number;
  /** Current timeline frame (ISO date) — null until the frame list is known. */
  date: string | null;
  playing: boolean;
  speedIdx: number;
  /** Frame currently loading (for the timeline spinner). */
  loading: boolean;
  /** The current frame has no imagery (e.g. a GIBS/GRACE gap month: tiles 404). */
  frameMissing: boolean;
  overlayError: string | null;
  mapCommand: MapCommand | null;

  set: (p: Partial<LayerState>) => void;
  /** Ask the (already visible) map to fly somewhere. */
  flyMap: (c: Omit<MapCommand, 'nonce'>) => void;
};

export const useLayers = create<LayerState>((set, get) => ({
  variableId: null,
  layer: null,
  frames: [],
  basemap: mapConfig.defaultBasemap,
  overlayOn: true,
  opacity: mapConfig.variableLayer.opacity,
  date: null,
  playing: false,
  speedIdx: mapConfig.variableLayer.defaultSpeed,
  loading: false,
  frameMissing: false,
  overlayError: null,
  mapCommand: null,
  set: (p) => set(p),
  flyMap: (c) => set({ mapCommand: { ...c, nonce: (get().mapCommand?.nonce ?? 0) + 1 } }),
}));

// Dev-only handle for debugging and automated screenshots.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __tdLayers: typeof useLayers }).__tdLayers = useLayers;
}

