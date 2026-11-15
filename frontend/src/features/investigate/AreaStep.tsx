import { useEffect, useState } from 'react';
import type { BBox } from '../../api/types';
import { Button } from '../../components/Button';
import { isValidBBox } from '../../lib/geo';
import { needsNoArea, useSelectedVariable, useStore } from '../../state/store';

const FIELDS: { key: keyof BBox; label: string; min: number; max: number }[] = [
  { key: 'north', label: 'North', min: -90, max: 90 },
  { key: 'west', label: 'West', min: -180, max: 180 },
  { key: 'east', label: 'East', min: -180, max: 180 },
  { key: 'south', label: 'South', min: -90, max: 90 },
];

/** Bounding-box readout. Editable: values commit on blur or Enter when the box is valid. */
export function AreaStep() {
  const bbox = useStore((s) => s.bbox);
  const setBBox = useStore((s) => s.setBBox);
  const set = useStore((s) => s.set);
  const [draft, setDraft] = useState<Record<keyof BBox, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const noArea = useStore(needsNoArea);
  const variable = useSelectedVariable();
  const region = useStore((s) => (s.region && s.region.bbox === s.bbox ? s.region : null));

  useEffect(() => {
    setDraft(bbox ? { west: String(bbox.west), south: String(bbox.south), east: String(bbox.east), north: String(bbox.north) } : null);
    setError(null);
  }, [bbox]);

  if (noArea) {
    return (
      <p className="notes">
        {variable?.coverage === 'series'
          ? variable.location
            ? `Global record: one station, ${variable.location.label}. The map area is not used.`
            : 'Global record: one worldwide average. The map area is not used.'
          : 'Your own data is a single series, so the map area is not used.'}
      </p>
    );
  }

  if (region) {
    const deg = `${region.cell_deg}°`;
    const km = Math.round(region.cell_deg * 111);
    return (
      <div className="area area--region">
        <p className="area__region-name">
          {region.name} <span className="area__region-kind">{region.kind}</span>
        </p>
        <p className="notes">
          The boundary is approximated by <strong>{region.cells.length} squares</strong> of {deg} (about {km} km). The average uses only these squares,
          not the sea or neighbours around it.
        </p>
        <div className="area__actions">
          <Button size="s" variant="ghost" onClick={() => setBBox(region.bbox)} title="Use the whole rectangle around the region instead">
            Use rectangle
          </Button>
          <Button size="s" variant="ghost" onClick={() => setBBox(null)}>
            Clear
          </Button>
        </div>
      </div>
    );
  }

  if (!bbox || !draft) {
    return (
      <p className="notes">
        Draw a rectangle on the map with <strong>Draw area</strong>, or hold Shift and drag. Global records (like CO₂ at Mauna Loa) and your own data need no area: pick them in step 2.
      </p>
    );
  }

  const commit = () => {
    const next = Object.fromEntries(FIELDS.map((f) => [f.key, Number(draft[f.key])])) as BBox;
    if (Object.values(next).some((v) => !Number.isFinite(v)) || !isValidBBox(next)) {
      setError('West must be less than east, and south less than north (longitude −180 to 180, latitude −90 to 90).');
      return;
    }
    setError(null);
    if (FIELDS.some((f) => next[f.key] !== bbox[f.key])) setBBox(next);
  };

  return (
    <div className="area">
      <div className="area__grid">
        {FIELDS.map((f) => (
          <label key={f.key} className={`area__field area__field--${f.key}`}>
            <span>{f.label}</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.25"
              min={f.min}
              max={f.max}
              value={draft[f.key]}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
              onBlur={commit}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
            />
          </label>
        ))}
        <span className="area__box" aria-hidden />
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="area__actions">
        <span className="hint">Drag the box edge to move it.</span>
        <Button size="s" variant="ghost" onClick={() => set({ drawing: true })}>
          Redraw
        </Button>
        <Button size="s" variant="ghost" onClick={() => setBBox(null)}>
          Clear
        </Button>
      </div>
    </div>
  );
}
