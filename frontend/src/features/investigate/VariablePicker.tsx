import { useEffect, useState } from 'react';
import { UPLOAD_PREFIX, type Sphere, type Variable } from '../../api/types';
import { Chip } from '../../components/Badge';
import { Button } from '../../components/Button';
import { useStore } from '../../state/store';
import { UploadDataset } from '../datasets/UploadDataset';

const SPHERES: { id: Sphere; label: string }[] = [
  { id: 'atmosphere', label: 'Atmosphere' },
  { id: 'land', label: 'Land' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'water', label: 'Water cycle' },
];

const years = (v: Variable) => `${v.available_start.slice(0, 4)}–${v.available_end.slice(0, 4)}`;

function VariableOption({ v, selected, onSelect }: { v: Variable; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={selected} className="var-opt" onClick={onSelect}>
      <span className="var-opt__name">
        {v.name} <span className="var-opt__units">{v.units === 'unitless' ? '' : v.units}</span>
      </span>
      <span className="var-opt__def">{v.short_definition}</span>
      <span className="var-opt__chips">
        <Chip>{v.mission_or_model}</Chip>
        {v.dataset && <Chip>{v.dataset}</Chip>}
        <Chip>{years(v)}</Chip>
        {v.coverage === 'series' && <Chip>{v.location ? `Station: ${v.location.label}` : 'Global record'}</Chip>}
        {(v.coverage === 'land' || v.coverage === 'ocean') && <Chip>{v.coverage} only</Chip>}
      </span>
    </button>
  );
}

/** Variable choice, grouped by Earth sphere, plus the user's own uploads as "Your data". */
export function VariablePicker() {
  const variables = useStore((s) => s.variables);
  const datasets = useStore((s) => s.datasets);
  const variableId = useStore((s) => s.variableId);
  const selectVariable = useStore((s) => s.selectVariable);
  const catalogError = useStore((s) => s.catalogError);
  const [open, setOpen] = useState(!variableId);

  useEffect(() => {
    if (!variableId) setOpen(true);
  }, [variableId]);

  const selected = variables.find((v) => v.id === variableId);
  const selectedUpload = datasets.find((d) => `${UPLOAD_PREFIX}${d.id}` === variableId);
  const choose = (id: string) => {
    selectVariable(id);
    setOpen(false);
  };

  if (catalogError) return <p className="field-error">{catalogError}</p>;

  if (!open && (selected || selectedUpload)) {
    return (
      <div className="var-selected">
        <div className="var-selected__head">
          <strong>{selected?.name ?? selectedUpload?.name}</strong>
          <Button size="s" variant="ghost" onClick={() => setOpen(true)}>
            Change
          </Button>
        </div>
        {selected ? (
          <>
            <p className="notes">{selected.short_definition}</p>
            <p className="notes notes--dim">{selected.why_it_matters}</p>
            <div className="var-opt__chips">
              <Chip>{selected.mission_or_model}</Chip>
              {selected.dataset && <Chip>{selected.dataset}</Chip>}
              {selected.units !== 'unitless' && <Chip>{selected.units}</Chip>}
              <Chip>{years(selected)}</Chip>
            </div>
            <p className="hint" title={selected.product}>
              Source: {selected.source}
              {selected.access ? `. Data via ${selected.access}.` : ''}
            </p>
          </>
        ) : (
          selectedUpload && (
            <p className="notes">
              Your upload: {selectedUpload.n} values from {selectedUpload.start} to {selectedUpload.end}
              {selectedUpload.units ? ` in ${selectedUpload.units}` : ''}. The map area is ignored for your own data.
            </p>
          )
        )}
      </div>
    );
  }

  return (
    <div className="var-picker" role="radiogroup" aria-label="Variable">
      {variables.length === 0 && <p className="hint">Loading variables…</p>}
      {SPHERES.map((s) => {
        const group = variables.filter((v) => v.sphere === s.id);
        if (!group.length) return null;
        return (
          <div key={s.id} className="var-group">
            <h3 className="var-group__title">{s.label}</h3>
            {group.map((v) => (
              <VariableOption key={v.id} v={v} selected={v.id === variableId} onSelect={() => choose(v.id)} />
            ))}
          </div>
        );
      })}
      <div className="var-group">
        <h3 className="var-group__title">Your data</h3>
        {datasets.map((d) => (
          <button
            key={d.id}
            type="button"
            role="radio"
            aria-checked={variableId === `${UPLOAD_PREFIX}${d.id}`}
            className="var-opt"
            onClick={() => choose(`${UPLOAD_PREFIX}${d.id}`)}
          >
            <span className="var-opt__name">
              {d.name} <span className="var-opt__units">{d.units}</span>
            </span>
            <span className="var-opt__chips">
              <Chip>{d.n} values</Chip>
              <Chip>
                {d.start.slice(0, 4)}–{d.end.slice(0, 4)}
              </Chip>
            </span>
          </button>
        ))}
        <UploadDataset onUploaded={(id) => choose(`${UPLOAD_PREFIX}${id}`)} />
      </div>
    </div>
  );
}
