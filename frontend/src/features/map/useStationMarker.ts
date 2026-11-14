import maplibregl, { type Map as MlMap } from 'maplibre-gl';
import { useEffect } from 'react';
import { prefersReducedMotion } from '../../config/motion';
import { useSelectedVariable, useStore } from '../../state/store';

/** For station records (e.g. Mauna Loa CO₂), mark the station on the map and bring it into view. */
export function useStationMarker(map: MlMap | null) {
  const variable = useSelectedVariable();
  const view = useStore((s) => s.view);
  const loc = variable?.location ?? null;

  useEffect(() => {
    if (!map || !loc) return;
    const el = document.createElement('div');
    el.className = 'station-marker';
    el.innerHTML = '<span class="station-marker__dot"></span><span class="station-marker__label"></span>';
    (el.querySelector('.station-marker__label') as HTMLElement).textContent = loc.label;
    const marker = new maplibregl.Marker({ element: el, anchor: 'left', offset: [-7, 0] }).setLngLat([loc.lon, loc.lat]).addTo(map);
    if (view === 'map') map.easeTo({ center: [loc.lon, loc.lat], zoom: Math.max(map.getZoom(), 4), duration: prefersReducedMotion() ? 0 : 900 });
    return () => {
      marker.remove();
    };
  }, [map, loc, view]);
}
