import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useSelectedVariable, useStore } from '../../state/store';
import { framesFor, nearestFrame } from './frames';
import { useLayers } from './layerStore';

const gridDatesCache = new Map<string, Promise<string[]>>();

/**
 * Keeps the layer store's `layer` + `frames` in line with the selected variable and the
 * investigation date range, and keeps `date` on a valid frame. Mount once (MapView).
 */
export function useFrameSync() {
  const variable = useSelectedVariable();
  const start = useStore((s) => s.start);
  const end = useStore((s) => s.end);
  const layer = variable?.map_layer ?? null;
  const [gridDates, setGridDates] = useState<{ id: string; dates: string[] } | null>(null);

  // Grid layers: fetch the available months once per variable.
  useEffect(() => {
    if (!variable || layer?.kind !== 'grid') return;
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
  }, [variable?.id, layer?.kind]);

  useEffect(() => {
    const ls = useLayers.getState();
    if (!variable || !layer) {
      ls.set({ variableId: variable?.id ?? null, layer: null, frames: [], playing: false, gridLegend: null, overlayError: null });
      return;
    }
    const dates = layer.kind === 'grid' && gridDates?.id === variable.id ? gridDates.dates : null;
    const frames = framesFor(layer, start, end, dates);
    const changed = ls.variableId !== variable.id;
    const idx = nearestFrame(frames, changed ? null : ls.date);
    ls.set({
      variableId: variable.id,
      layer,
      frames,
      date: idx >= 0 ? frames[idx] : null,
      ...(changed ? { playing: false, gridLegend: null, overlayError: null } : {}),
    });
  }, [variable, layer, start, end, gridDates]);
}
