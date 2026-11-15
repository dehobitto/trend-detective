import type { Map as MlMap } from 'maplibre-gl';
import { useEffect } from 'react';
import { createWheelClassifier } from '../globe/wheelIntent';

/**
 * MapLibre zooms on every wheel event. On a trackpad a two-finger swipe should pan instead (like most
 * map apps); pinch (ctrl+wheel) and a real mouse wheel still go to MapLibre's scroll zoom, so zooming
 * out past the threshold still returns to the globe. Same classifier as the globe (globe/wheelIntent.ts).
 */
export function useTrackpadPan(map: MlMap | null) {
  useEffect(() => {
    if (!map) return;
    const host = map.getContainer();
    const classify = createWheelClassifier();
    const onWheel = (e: WheelEvent) => {
      if (classify(e) !== 'rotate') return;
      e.preventDefault();
      e.stopPropagation();
      map.panBy([e.deltaX, e.deltaY], { animate: false });
    };
    host.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => host.removeEventListener('wheel', onWheel, { capture: true });
  }, [map]);
}
