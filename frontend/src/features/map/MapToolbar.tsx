import { Button } from '../../components/Button';
import { needsNoArea, useStore } from '../../state/store';
import { wrapLon } from '../../lib/geo';
import { IconBack, IconRect, IconUpload } from '../../components/icons';

/** Map tools, docked top-left under the wordmark. */
export function MapToolbar({ panelOpen }: { panelOpen: boolean }) {
  const drawing = useStore((s) => s.drawing);
  const set = useStore((s) => s.set);
  const backToGlobe = useStore((s) => s.backToGlobe);
  const focus = useStore((s) => s.focus);

  return (
    <div className="map-toolbar" role="toolbar" aria-label="Map tools">
      <Button
        variant="quiet"
        onClick={() => {
          backToGlobe({ lat: focus.lat, lon: wrapLon(focus.lon) });
        }}
      >
        <IconBack /> Back to globe
      </Button>
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
  if (bbox && !drawing) return null;
  if (!drawing && noArea) return null;
  return (
    <p className="map-hint" role="status">
      {drawing ? 'Drag on the map to draw your area. Press Esc to cancel.' : 'Draw an area to investigate. Use the Draw area tool, or hold Shift and drag.'}
    </p>
  );
}
