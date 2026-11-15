import { useEffect } from 'react';
import { useSelectedVariable, useStore } from '../../state/store';
import { framesFor, nearestFrame } from './frames';
import { useLayers } from './layerStore';

/**
 * Keeps the layer store's `layer` + `frames` in line with the selected variable (its NASA GIBS imagery)
 * and the investigation date range, and keeps `date` on a valid frame. Mount once (App: the globe and the map share it).
 */
export function useFrameSync() {
  const variable = useSelectedVariable();
  const start = useStore((s) => s.start);
  const end = useStore((s) => s.end);
  const layer = variable?.map_layer ?? null;

  useEffect(() => {
    const ls = useLayers.getState();
    if (!variable || !layer) {
      ls.set({ variableId: variable?.id ?? null, layer: null, frames: [], date: null, playing: false, overlayError: null, frameMissing: false, loading: false });
      return;
    }
    const changed = ls.variableId !== variable.id;
    const frames = framesFor(layer, start, end);
    const idx = nearestFrame(frames, changed ? null : ls.date);
    ls.set({
      variableId: variable.id,
      layer,
      frames,
      date: idx >= 0 ? frames[idx] : null,
      ...(changed ? { playing: false, overlayError: null } : {}),
    });
  }, [variable, layer, start, end]);
}
