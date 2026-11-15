import { useEffect } from 'react';
import { Button } from '../../components/Button';
import { mapConfig } from '../../config/map';
import { needsNoArea, useStore } from '../../state/store';
import { wrapLon } from '../../lib/geo';
import { prefersReducedMotion } from '../../config/motion';
import { globeConfig } from '../../config/globe';
import { distanceForZoom, globeScreenOffset, handoff, matchedZoom } from '../globe/handoff';
import { IconBack, IconList, IconRect, IconUpload } from '../../components/icons';

/** Map tools, docked top-left under the wordmark. */
export function MapToolbar({ panelOpen }: { panelOpen: boolean }) {
  const drawing = useStore((s) => s.drawing);
  const set = useStore((s) => s.set);
  const backToGlobe = useStore((s) => s.backToGlobe);
  const focus = useStore((s) => s.focus);
  const flat = useStore((s) => s.flat);
  const casesOpen = useStore((s) => s.casesOpen);
  const setFlat = useStore((s) => s.setFlat);

  return (
    <div className="map-toolbar" role="toolbar" aria-label="Map tools">
      {flat ? (
        <>
          <Button variant="quiet" onClick={() => setFlat(false)} title="Switch back to the 3D globe (remembered on this device)">
            <IconBack /> 3D globe
          </Button>
          <Button variant={casesOpen ? 'primary' : 'quiet'} aria-pressed={casesOpen} onClick={() => set({ casesOpen: !casesOpen, drawing: false, ...(!casesOpen ? { panelCollapsed: true } : {}) })}>
            <IconList /> Examples
          </Button>
        </>
      ) : (
        <Button
          variant="quiet"
          onClick={() => {
            // Glide the map out to the globe's scale first (same screen point), then crossfade: no jump.
            const m = handoff.map;
            if (!m) return backToGlobe({ lat: focus.lat, lon: wrapLon(focus.lon) });
            const c = m.getCenter();
            const el = m.getContainer();
            const zoom = matchedZoom(c.lat, globeConfig.arrivalDistance, el.clientHeight);
            const { dx, dy } = globeScreenOffset(el.clientWidth, el.clientHeight, globeConfig.arrivalDistance);
            let left = false;
            const leave = () => {
              if (left) return;
              left = true;
              backToGlobe({ lat: c.lat, lon: wrapLon(c.lng) }, distanceForZoom(c.lat, m.getZoom(), el.clientHeight));
            };
            if (prefersReducedMotion()) return leave();
            // Crossfade only from a fully drawn frame: wait (briefly) for the zoomed-out tiles to arrive.
            m.once('moveend', () => {
              if (m.areTilesLoaded()) return leave();
              const t = window.setTimeout(leave, 600);
              m.once('idle', () => {
                window.clearTimeout(t);
                leave();
              });
            });
            const levels = Math.max(0, m.getZoom() - zoom);
            m.easeTo({ center: c, zoom: Math.min(m.getZoom(), zoom), offset: [dx, dy], duration: Math.min(900, 300 + 120 * levels), easing: (t) => t * (2 - t) });
          }}
        >
          <IconBack /> Back to globe
        </Button>
      )}
      <Button variant={drawing ? 'primary' : 'quiet'} aria-pressed={drawing} onClick={() => set({ drawing: !drawing })} title="Or hold Shift and drag">
        <IconRect /> {drawing ? 'Drawing…' : 'Draw area'}
      </Button>
      {!panelOpen && (
        <Button variant="quiet" onClick={() => set({ panelRequested: true })}>
          <IconUpload /> Global records or your data
        </Button>
      )}
    </div>
  );
}

export function MapHint() {
  const drawing = useStore((s) => s.drawing);
  const bbox = useStore((s) => s.bbox);
  const noArea = useStore(needsNoArea);
  const casesOpen = useStore((s) => s.flat && s.casesOpen);
  const notice = useStore((s) => s.mapNotice);
  const set = useStore((s) => s.set);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => set({ mapNotice: null }), mapConfig.noticeMs);
    return () => clearTimeout(t);
  }, [notice, set]);
  if (notice) {
    return (
      <p className="map-hint" role="status">
        {notice}
      </p>
    );
  }
  if (bbox && !drawing) return null;
  if (casesOpen && !drawing) return null;
  if (!drawing && noArea) return null;
  return (
    <p className="map-hint" role="status">
      {drawing ? 'Drag on the map to draw your area. Press Esc to cancel.' : matchMedia('(pointer: coarse)').matches
          ? 'Draw an area to investigate: tap Draw area, then drag on the map.'
          : 'Draw an area to investigate. Use the Draw area tool, or hold Shift and drag.'}
    </p>
  );
}
