import { create } from 'zustand';
import type { Aggregation, BBox, Dataset, ExampleCase, Job, Variable } from '../api/types';
import type { ApiMode } from '../api/client';
import { appConfig } from '../config/app';

export type View = 'globe' | 'map';
/** Globe-side animation phase. 'flyingIn' ends with view = 'map'; 'flyingOut' runs after returning. */
export type Transition = 'idle' | 'flyingIn' | 'flyingOut';
export type LatLon = { lat: number; lon: number };

type State = {
  apiMode: ApiMode | 'connecting';
  view: View;
  transition: Transition;
  /** Where the camera / map is centred during a hand-off. */
  focus: LatLon;
  /** Bumps each time the map should re-centre on `focus` (or fit `bbox` when fitBBox). */
  mapEnter: { nonce: number; fitBBox: boolean };
  /** Mount the map lazily the first time it's needed, then keep it. */
  mapMounted: boolean;

  bbox: BBox | null;
  drawing: boolean;
  panelRequested: boolean;

  variables: Variable[];
  examples: ExampleCase[];
  datasets: Dataset[];
  catalogError: string | null;

  variableId: string | null;
  start: string;
  end: string;
  aggregation: Aggregation;
  deseasonalize: boolean;
  alpha: number;

  job: Job | null;
  runError: string | null;
  /** The example case the user opened (drives the takeaway and the "Compare with" action). */
  activeExample: ExampleCase | null;

  chatOpen: boolean;
};

type Actions = {
  set: (patch: Partial<State>) => void;
  flyTo: (to: LatLon, fitBBox?: boolean) => void;
  arriveAtMap: () => void;
  backToGlobe: (from: LatLon) => void;
  finishTransition: () => void;
  setBBox: (b: BBox | null) => void;
  applyExample: (ex: ExampleCase) => void;
  selectVariable: (id: string) => void;
  clearResult: () => void;
};

export const useStore = create<State & Actions>((set, get) => ({
  apiMode: 'connecting',
  view: 'globe',
  transition: 'idle',
  focus: { lat: 0, lon: 0 },
  mapEnter: { nonce: 0, fitBBox: false },
  mapMounted: false,

  bbox: null,
  drawing: false,
  panelRequested: false,

  variables: [],
  examples: [],
  datasets: [],
  catalogError: null,

  variableId: null,
  start: appConfig.defaults.start,
  end: appConfig.defaults.end,
  aggregation: 'monthly',
  deseasonalize: true,
  alpha: appConfig.defaults.alpha,

  job: null,
  runError: null,
  activeExample: null,

  chatOpen: false,

  set: (patch) => set(patch),

  flyTo: (to, fitBBox = false) => {
    if (get().transition !== 'idle' || get().view !== 'globe') return;
    set({ transition: 'flyingIn', focus: to, mapMounted: true, mapEnter: { nonce: get().mapEnter.nonce, fitBBox } });
  },

  arriveAtMap: () =>
    set((s) => ({ view: 'map', transition: 'idle', mapEnter: { nonce: s.mapEnter.nonce + 1, fitBBox: s.mapEnter.fitBBox } })),

  backToGlobe: (from) => set({ view: 'globe', transition: 'flyingOut', focus: from, drawing: false }),

  finishTransition: () => set({ transition: 'idle' }),

  setBBox: (bbox) => set({ bbox, job: null, runError: null }),

  applyExample: (ex) => {
    set({
      bbox: ex.bbox,
      variableId: ex.variable_id,
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
    const v = get().variables.find((x) => x.id === id);
    const patch: Partial<State> = { variableId: id, job: null, runError: null };
    if (v) {
      // Keep the chosen dates inside what the instrument actually covers.
      if (get().start < v.available_start) patch.start = v.available_start;
      if (get().end > v.available_end) patch.end = v.available_end;
    }
    const ds = get().datasets.find((d) => `upload:${d.id}` === id);
    if (ds) {
      patch.start = ds.start;
      patch.end = ds.end;
    }
    set(patch);
  },

  clearResult: () => set({ job: null, runError: null }),
}));

/** The selected catalog variable (undefined for uploads or nothing selected). */
export const useSelectedVariable = () => useStore((s) => s.variables.find((v) => v.id === s.variableId));

/** True when the current choice needs no map area: a global record ("series") or an upload. */
export function needsNoArea(s: Pick<State, 'variables' | 'variableId'>): boolean {
  if (!s.variableId) return false;
  if (s.variableId.startsWith('upload:')) return true;
  return s.variables.find((v) => v.id === s.variableId)?.coverage === 'series';
}

// Dev-only handle for debugging and automated screenshots.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __td: typeof useStore }).__td = useStore;
}
