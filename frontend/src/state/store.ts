import { create } from 'zustand';
import type { Aggregation, BBox, Dataset, ExampleCase, Job, Phenomenon, RegionShape, Variable } from '../api/types';
import { appConfig } from '../config/app';
import { mapConfig } from '../config/map';
import { PHENOMENA } from '../features/investigate/phenomena';

export type View = 'globe' | 'map';
/** Globe-side animation phase. 'flyingIn' ends with view = 'map'; 'flyingOut' runs after returning. */
export type Transition = 'idle' | 'flyingIn' | 'flyingOut';
export type LatLon = { lat: number; lon: number };
/** How the map should frame the arrival: explicit zoom, a place's bounds, or 'wheel' (globe zoom gesture → gentler zoom). */
export type Arrival = { zoom?: number; bounds?: BBox | null; via?: 'click' | 'wheel' | 'search' };

/**
 * The globe hands off to the map both on click and when wheel/pinch-zooming past a threshold.
 * Those arrive at different zooms; a hand-off within a moment of a wheel/pinch gesture counts as 'wheel'.
 */
let lastZoomGestureAt = -Infinity;
if (typeof window !== 'undefined') {
  const mark = () => (lastZoomGestureAt = performance.now());
  window.addEventListener('wheel', mark, { capture: true, passive: true });
  window.addEventListener('touchmove', (e) => e.touches.length > 1 && mark(), { capture: true, passive: true });
}
const recentZoomGesture = () => performance.now() - lastZoomGestureAt < 600;
export type MapEnter = { nonce: number; fitBBox: boolean } & Arrival;

/** 2D-only mode: from the URL (?view=2d / ?view=3d) or what this device chose last time. */
function readFlat(): boolean {
  try {
    const v = new URLSearchParams(window.location.search).get('view');
    if (v === '2d') return true;
    if (v === '3d') return false;
    return window.localStorage.getItem(mapConfig.flatStorageKey) === '2d';
  } catch {
    return false;
  }
}
function saveFlat(flat: boolean) {
  try {
    window.localStorage.setItem(mapConfig.flatStorageKey, flat ? '2d' : '3d');
  } catch {
    /* private mode etc.: the choice just isn't remembered */
  }
}
const startFlat = typeof window !== 'undefined' && readFlat();


type State = {
  /** Backend reachability, checked once at startup (there is no offline fallback). */
  server: 'connecting' | 'online' | 'offline';
  /** 2D-only mode: no globe at all, the flat map is the home screen. */
  flat: boolean;
  /** 2D-only mode: the example case list is open over the map. */
  casesOpen: boolean;
  view: View;
  transition: Transition;
  /** Where the camera / map is centred during a hand-off. */
  focus: LatLon;
  /**
   * Bumps each time the map should re-centre on `focus` (or fit `bbox` when fitBBox).
   * `zoom` overrides the arrival zoom; `bounds` frames a place (search result) instead.
   */
  mapEnter: MapEnter;
  /** Mount the map lazily the first time it's needed, then keep it. */
  mapMounted: boolean;

  bbox: BBox | null;
  /** A named area picked by name (country, state, city): its boundary and squares; bbox = the squares' box. */
  region: RegionShape | null;
  drawing: boolean;
  panelRequested: boolean;
  /** Phones: the investigation bottom sheet is folded down to its grip (the timeline dock docks above it). */
  panelCollapsed: boolean;

  variables: Variable[];
  examples: ExampleCase[];
  datasets: Dataset[];
  catalogError: string | null;

  variableId: string | null;
  /** Multiple variables selected via checkboxes in variable mode. */
  selectedVariableIds: string[];
  /** 'variable' = single variable, 'phenomenon' = multi-variable investigation. */
  pickerMode: 'variable' | 'phenomenon';
  /** Currently selected phenomenon (null when in variable mode). */
  phenomenonId: string | null;
  /** Jobs for each variable in a phenomenon, keyed by variable_id. */
  phenomenonJobs: Record<string, Job | null>;
  /** Error from any variable in a phenomenon run. */
  phenomenonError: string | null;
  start: string;
  end: string;
  aggregation: Aggregation;
  deseasonalize: boolean;
  alpha: number;

  job: Job | null;
  runError: string | null;
  /** The example case the user opened (drives the "Compare with" action). */
  activeExample: ExampleCase | null;

  chatOpen: boolean;
  /** A question to open the field guide with (asked straight away), from anywhere in the UI. */
  chatAsk: string | null;
  /** A short note shown over the map for a few seconds (e.g. "your area was enlarged"). */
  mapNotice: string | null;

  /** Turn the globe (without zooming) to face a place, e.g. the station behind a record. */
  peek: (LatLon & { nonce: number }) | null;
  /** Run the analysis as soon as the investigation panel is ready (set by "Show the global record"). */
  pendingRun: boolean;
  /** Globe camera distance to start the fly-out from (matches the map's scale when it was left). */
  exitDistance: number | null;
};

type Actions = {
  set: (patch: Partial<State>) => void;
  flyTo: (to: LatLon, fitBBox?: boolean, arrival?: Arrival) => void;
  /** Switch between the globe and the 2D-only map (remembered on this device). */
  setFlat: (flat: boolean) => void;
  arriveAtMap: () => void;
  /** Leave the map; `distance` = globe camera distance that matches the map's current scale (smooth crossfade). */
  backToGlobe: (from: LatLon, distance?: number) => void;
  finishTransition: () => void;
  setBBox: (b: BBox | null) => void;
  /** Use a named region (from place search) as the area: outline + squares on the map, average inside only. */
  applyRegion: (r: RegionShape) => void;
  applyExample: (ex: ExampleCase) => void;
  selectVariable: (id: string) => void;
  toggleVariable: (id: string) => void;
  selectPhenomenon: (phenomenon: Phenomenon) => void;
  /** Apply a phenomenon with a specific bbox (from an example case). */
  applyPhenomenonExample: (phenomenon: Phenomenon, bbox: BBox | null, center: { lat: number; lon: number }, start: string, end: string, deseasonalize: boolean) => void;
  setPickerMode: (mode: 'variable' | 'phenomenon') => void;
  peekAt: (to: LatLon) => void;
  clearResult: () => void;
};

export const useStore = create<State & Actions>((set, get) => ({
  server: 'connecting',
  flat: startFlat,
  casesOpen: startFlat,
  view: startFlat ? 'map' : 'globe',
  transition: 'idle',
  focus: startFlat ? { lat: 20, lon: 10 } : { lat: 0, lon: 0 },
  mapEnter: startFlat ? { nonce: 1, fitBBox: false, zoom: mapConfig.flatStartZoom() } : { nonce: 0, fitBBox: false },
  mapMounted: startFlat,

  bbox: null,
  region: null,
  drawing: false,
  panelRequested: false,
  panelCollapsed: false,

  variables: [],
  examples: [],
  datasets: [],
  catalogError: null,

  variableId: null,
  selectedVariableIds: [],
  pickerMode: 'variable',
  phenomenonId: null,
  phenomenonJobs: {},
  phenomenonError: null,
  start: appConfig.defaults.start,
  end: appConfig.defaults.end,
  aggregation: 'monthly',
  deseasonalize: true,
  alpha: appConfig.defaults.alpha,

  job: null,
  runError: null,
  activeExample: null,

  chatOpen: false,
  chatAsk: null,
  mapNotice: null,

  peek: null,
  pendingRun: false,
  exitDistance: null,

  set: (patch) => set(patch),

  flyTo: (to, fitBBox = false, arrival = {}) => {
    if (get().flat) {
      // No globe: the map itself moves there (frames the box / place, or zooms in on the point).
      set((s) => ({ focus: to, casesOpen: false, mapEnter: { nonce: s.mapEnter.nonce + 1, fitBBox, ...arrival, via: arrival.via ?? 'click' } }));
      return;
    }
    if (get().transition !== 'idle' || get().view !== 'globe') return;
    const via = arrival.via ?? (recentZoomGesture() ? 'wheel' : 'click');
    set({ transition: 'flyingIn', focus: to, mapMounted: true, mapEnter: { nonce: get().mapEnter.nonce, fitBBox, ...arrival, via } });
  },

  setFlat: (flat) => {
    saveFlat(flat);
    const s = get();
    if (flat === s.flat) return;
    if (flat) {
      set({
        flat: true,
        casesOpen: !s.bbox,
        view: 'map',
        transition: 'idle',
        mapMounted: true,
        mapEnter: { nonce: s.mapEnter.nonce + 1, fitBBox: !!s.bbox, zoom: s.bbox ? undefined : mapConfig.flatStartZoom(), via: 'click' },
      });
    } else {
      set({ flat: false, casesOpen: false });
      if (s.view === 'map') s.backToGlobe(s.focus);
    }
  },

  arriveAtMap: () => set((s) => ({ view: 'map', transition: 'idle', mapEnter: { ...s.mapEnter, nonce: s.mapEnter.nonce + 1 } })),

  backToGlobe: (from, distance) => set({ view: 'globe', transition: 'flyingOut', focus: from, drawing: false, exitDistance: distance ?? null }),

  finishTransition: () => set({ transition: 'idle' }),

  // Any hand-made box (drawn, dragged, typed, an example's) replaces a named region.
  setBBox: (bbox) => set({ bbox, region: null, job: null, runError: null, ...(bbox ? { casesOpen: false } : {}) }),

  applyRegion: (region) => set({ bbox: region.bbox, region, job: null, runError: null, casesOpen: false, activeExample: null }),

  applyExample: (ex) => {
    set({
      bbox: ex.bbox,
      region: null,
      variableId: ex.variable_id,
      selectedVariableIds: [ex.variable_id],
      pickerMode: 'variable',
      phenomenonId: null,
      phenomenonJobs: {},
      phenomenonError: null,
      start: ex.start,
      end: ex.end,
      deseasonalize: ex.deseasonalize,
      aggregation: 'monthly',
      job: null,
      runError: null,
      activeExample: ex,
    });
    get().flyTo(ex.center, true);
  },

  selectVariable: (id) => {
    const s = get();
    const v = s.variables.find((x) => x.id === id);
    const patch: Partial<State> = { variableId: id, selectedVariableIds: [id], job: null, runError: null, phenomenonId: null, phenomenonJobs: {}, phenomenonError: null };
    if (v) Object.assign(patch, clampRange(s.start, s.end, v));
    const ds = s.datasets.find((d) => `upload:${d.id}` === id);
    if (ds) {
      patch.start = ds.start;
      patch.end = ds.end;
    }
    set(patch);
  },

  toggleVariable: (id) => {
    const s = get();
    const prev = s.selectedVariableIds;
    const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    // Clamp date range to intersection of all selected variables.
    const vars = next.map((vid) => s.variables.find((v) => v.id === vid)).filter((v): v is Variable => !!v);
    let start = s.start;
    let end = s.end;
    if (vars.length) {
      const latestStart = vars.reduce((a, v) => (v.available_start > a ? v.available_start : a), vars[0].available_start);
      const earliestEnd = vars.reduce((a, v) => (v.available_end < a ? v.available_end : a), vars[0].available_end);
      const clamped = clampRange(s.start, s.end, { ...vars[0], available_start: latestStart, available_end: earliestEnd });
      start = clamped.start;
      end = clamped.end;
    }
    set({
      selectedVariableIds: next,
      variableId: next.length === 1 ? next[0] : null,
      job: null,
      runError: null,
      phenomenonJobs: {},
      phenomenonError: null,
      start,
      end,
    });
  },

  selectPhenomenon: (phenomenon) => {
    const s = get();
    // Date range = intersection of all phenomenon variables' available ranges.
    const vars = phenomenon.variables
      .map((ve) => s.variables.find((v) => v.id === ve.variable_id))
      .filter((v): v is Variable => !!v);
    let start = s.start;
    let end = s.end;
    if (vars.length) {
      const latestStart = vars.reduce((a, v) => (v.available_start > a ? v.available_start : a), vars[0].available_start);
      const earliestEnd = vars.reduce((a, v) => (v.available_end < a ? v.available_end : a), vars[0].available_end);
      const clamped = clampRange(s.start, s.end, { ...vars[0], available_start: latestStart, available_end: earliestEnd });
      start = clamped.start;
      end = clamped.end;
    }
    set({
      phenomenonId: phenomenon.id,
      variableId: null,
      job: null,
      runError: null,
      phenomenonJobs: {},
      phenomenonError: null,
      start,
      end,
    });
  },

  applyPhenomenonExample: (phenomenon, bbox, center, start, end, deseasonalize) => {
    const s = get();
    // Clamp to intersection of phenomenon variables.
    const vars = phenomenon.variables
      .map((ve) => s.variables.find((v) => v.id === ve.variable_id))
      .filter((v): v is Variable => !!v);
    let rangeStart = start;
    let rangeEnd = end;
    if (vars.length) {
      const latestStart = vars.reduce((a, v) => (v.available_start > a ? v.available_start : a), vars[0].available_start);
      const earliestEnd = vars.reduce((a, v) => (v.available_end < a ? v.available_end : a), vars[0].available_end);
      const clamped = clampRange(start, end, { ...vars[0], available_start: latestStart, available_end: earliestEnd });
      rangeStart = clamped.start;
      rangeEnd = clamped.end;
    }
    set({
      bbox,
      region: null,
      pickerMode: 'phenomenon',
      phenomenonId: phenomenon.id,
      variableId: null,
      selectedVariableIds: [],
      job: null,
      runError: null,
      phenomenonJobs: {},
      phenomenonError: null,
      activeExample: null,
      start: rangeStart,
      end: rangeEnd,
      deseasonalize,
      aggregation: 'monthly',
    });
    get().flyTo(center, true);
  },

  setPickerMode: (mode) => {
    const s = get();
    if (mode === s.pickerMode) return;
    set({
      pickerMode: mode,
      // Clear selection when switching modes.
      variableId: mode === 'variable' ? s.variableId : null,
      phenomenonId: mode === 'phenomenon' ? s.phenomenonId : null,
      job: null,
      runError: null,
      phenomenonJobs: {},
      phenomenonError: null,
    });
  },

  peekAt: (to) => set((s) => ({ peek: { ...to, nonce: (s.peek?.nonce ?? 0) + 1 } })),

  clearResult: () => set({ job: null, runError: null }),
}));

/**
 * Dates for a newly chosen variable. Records ("series") default to their full span; everything else
 * keeps the user's range, clamped into what the instrument covers (full span if nothing overlaps).
 */
export function clampRange(start: string, end: string, v: Variable): { start: string; end: string } {
  const full = { start: v.available_start, end: v.available_end };
  if (v.coverage === 'series') return full;
  const s = start < v.available_start ? v.available_start : start > v.available_end ? v.available_start : start;
  const e = end > v.available_end ? v.available_end : end < v.available_start ? v.available_end : end;
  // Need at least a couple of years for a trend; otherwise fall back to everything available.
  if (Number(e.slice(0, 4)) - Number(s.slice(0, 4)) < 2) return full;
  return { start: s, end: e };
}

/** The selected catalog variable (undefined for uploads or nothing selected). */
export const useSelectedVariable = () => useStore((s) => s.variables.find((v) => v.id === s.variableId));

/** True when the current choice needs no map area: a global record ("series"), an upload, or a global phenomenon. */
export function needsNoArea(s: Pick<State, 'variables' | 'variableId' | 'selectedVariableIds' | 'pickerMode' | 'phenomenonId'>): boolean {
  if (s.pickerMode === 'phenomenon' && s.phenomenonId) {
    const ph = PHENOMENA.find((p) => p.id === s.phenomenonId);
    return ph?.global ?? false;
  }
  // Multi-variable: all must be series for no area.
  if (s.selectedVariableIds.length > 1) {
    return s.selectedVariableIds.every((id) => s.variables.find((v) => v.id === id)?.coverage === 'series');
  }
  if (!s.variableId) return false;
  if (s.variableId.startsWith('upload:')) return true;
  return s.variables.find((v) => v.id === s.variableId)?.coverage === 'series';
}

// Dev-only handle for debugging and automated screenshots.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __td: typeof useStore }).__td = useStore;
}
