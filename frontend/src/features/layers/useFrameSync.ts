import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useSelectedVariable, useStore } from '../../state/store';
import { framesFor, nearestFrame } from './frames';
import { useLayers, usesGrid } from './layerStore';

const gridDatesCache = new Map<string, Promise<string[]>>();

/**
 * Keeps the layer store's `layer` + `frames` in line with the selected variable and the
 * investigation date range, and keeps `date` on a valid frame. Mount once (App: the globe and the map share it).
 */
export function useFrameSync() {
  const variable = useSelectedVariable();
  const start = useStore((s) => s.start);
  const end = useStore((s) => s.end);
  const layer = variable?.map_layer ?? null;
  const [gridDates, setGridDates] = useState<{ id: string; dates: string[] } | null>(null);
  const mode = useLayers((s) => s.mode);

  // Grid months (grid layers, and the anomaly/trend modes of every area variable): fetch once per variable.
  useEffect(() => {
    if (!variable || !layer) return;
    let live = true;
    const id = variable.id;
    let p = gridDatesCache.get(id);
    if (!p) {
      p = api.getGridDates(id);
      gridDatesCache.set(id, p);
      p.catch(() => gridDatesCache.delete(id));
    }
    p.then((dates) => live && setGridDates({ id, dates })).catch((e) => {
      if (live) useLayers.getState().set({ overlayError: `Map layer unavailable: ${e instanceof Error ? e.message : 'error'}` });
    });
    return () => {
      live = false;
    };
  }, [variable?.id, !!layer]);

  useEffect(() => {
    const ls = useLayers.getState();
    if (!variable || !layer) {
      ls.set({ variableId: variable?.id ?? null, layer: null, frames: [], playing: false, gridLegend: null, overlayError: null, trendPeriod: null });
      return;
    }
    const changed = ls.variableId !== variable.id;
    // A newly picked variable opens on its trend map: "where is it changing?" at a glance.
    const nextMode = changed ? 'trend' : ls.mode;
    const dates = gridDates?.id === variable.id ? gridDates.dates : null;
    const frames = usesGrid({ layer, mode: nextMode }) ? framesFor({ kind: 'grid' }, start, end, dates) : framesFor(layer, start, end, dates);
    // Keep the date when switching modes (GIBS 8-day/daily frames snap to the nearest grid month and back).
    const idx = nearestFrame(frames, changed ? null : ls.date);
    const month = (d: string) => `${d.slice(0, 7)}-01`;
    const s0 = month(start < variable.available_start ? variable.available_start : start);
    const e0 = month(end > variable.available_end ? variable.available_end : end);
    ls.set({
      variableId: variable.id,
      layer,
      frames,
      mode: nextMode,
      date: idx >= 0 ? frames[idx] : null,
      trendPeriod: s0 < e0 ? { start: s0, end: e0 } : null,
      ...(changed ? { playing: false, gridLegend: null, overlayError: null } : {}),
    });
  }, [variable, layer, start, end, gridDates, mode]);
}
