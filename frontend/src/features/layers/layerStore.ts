import { create } from 'zustand';
import type { BBox, Colormap, MapLayer } from '../../api/types';
import { mapConfig, type BasemapId } from '../../config/map';

/** One-shot camera request for the map (search result, "use this area"). */
export type MapCommand = { nonce: number; center: { lat: number; lon: number }; zoom?: number; bounds?: BBox | null };

export type GridLegend = { min: number; max: number; units: string; colormap: Colormap; synthetic: boolean; diverging?: boolean };

/**
 * What the variable layer shows:
 * - value: the variable itself for one frame (GIBS imagery when the variable has it, else the backend grid);
 * - anomaly: that month minus its long-term normal for the same calendar month (backend grid, mode=anomaly);
 * - trend: one map of the per-cell trend over the investigation period (backend TrendGrid).
 */
export type MapMode = 'value' | 'anomaly' | 'trend';

type LayerState = {
  /** The selected variable's map layer (null = nothing to show) and its timeline frames. */
  variableId: string | null;
  layer: MapLayer | null;
  frames: string[];
  /** Filled by the grid renderer from the latest GridFrame. */
  gridLegend: GridLegend | null;

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
  mode: MapMode;
  /** Trend mode: the period actually mapped (clamped to the variable's availability). */
  trendPeriod: { start: string; end: string } | null;

  set: (p: Partial<LayerState>) => void;
  /** Ask the (already visible) map to fly somewhere. */
  flyMap: (c: Omit<MapCommand, 'nonce'>) => void;
};

export const useLayers = create<LayerState>((set, get) => ({
  variableId: null,
  layer: null,
  frames: [],
  gridLegend: null,
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
  mode: 'trend',
  trendPeriod: null,
  set: (p) => set(p),
  flyMap: (c) => set({ mapCommand: { ...c, nonce: (get().mapCommand?.nonce ?? 0) + 1 } }),
}));

// Dev-only handle for debugging and automated screenshots.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __tdLayers: typeof useLayers }).__tdLayers = useLayers;
}

/** Does the current layer draw from the backend grid (rather than GIBS imagery)? */
export const usesGrid = (s: { layer: MapLayer | null; mode: MapMode }) => !!s.layer && (s.mode !== 'value' || s.layer.kind === 'grid');
