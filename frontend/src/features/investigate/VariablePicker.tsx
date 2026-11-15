import { useEffect, useState } from 'react';
import { UPLOAD_PREFIX, type Sphere, type Variable } from '../../api/types';
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

/** The details nobody needs to pick a variable, one tap away. */
function VariableDetails({ v }: { v: Variable }) {
  return (
    <div className="var-info">
      <p>{v.short_definition}</p>
      <p className="var-info__dim">{v.why_it_matters}</p>
      <p className="var-info__meta">
        {[v.mission_or_model, v.dataset, years(v), v.coverage === 'series' ? (v.location ? v.location.label : 'Global record') : null, v.coverage === 'land' || v.coverage === 'ocean' ? `${v.coverage} only` : null]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <p className="var-info__meta" title={v.product}>
        {v.source}
        {v.access ? `, via ${v.access}` : ''}
      </p>
    </div>
  );
}

function InfoToggle({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" className="info-btn" aria-expanded={open} aria-label={`About ${label}`} title={`About ${label}`} onClick={onToggle}>
      ?
    </button>
  );
}

function VariableOption({ v, selected, onSelect }: { v: Variable; selected: boolean; onSelect: () => void }) {
  const [info, setInfo] = useState(false);
  return (
    <div className="var-row">
      <div className="var-row__line">
        <button type="button" role="radio" aria-checked={selected} className="var-opt" onClick={onSelect}>
          <span className="var-opt__name">{v.name}</span>
          <span className="var-opt__units">{v.units === 'unitless' ? years(v) : `${v.units} · ${years(v)}`}</span>
        </button>
        <InfoToggle open={info} onToggle={() => setInfo(!info)} label={v.name} />
      </div>
      {info && <VariableDetails v={v} />}
    </div>
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
  const [selInfo, setSelInfo] = useState(false);

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
          {selected && <InfoToggle open={selInfo} onToggle={() => setSelInfo(!selInfo)} label={selected.name} />}
          <Button size="s" variant="ghost" onClick={() => setOpen(true)}>
            Change
          </Button>
        </div>
        {selected ? (
          <>
            <p className="var-opt__units">{selected.units === 'unitless' ? years(selected) : `${selected.units} · ${years(selected)}`}</p>
            {selInfo && <VariableDetails v={selected} />}
          </>
        ) : (
          selectedUpload && (
            <p className="notes">
              {selectedUpload.n} values, {selectedUpload.start.slice(0, 4)}–{selectedUpload.end.slice(0, 4)}
              {selectedUpload.units ? `, ${selectedUpload.units}` : ''}
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
            <span className="var-opt__name">{d.name}</span>
            <span className="var-opt__units">
              {d.units ? `${d.units} · ` : ''}
              {d.start.slice(0, 4)}–{d.end.slice(0, 4)}
            </span>
          </button>
        ))}
        <UploadDataset onUploaded={(id) => choose(`${UPLOAD_PREFIX}${id}`)} />
      </div>
    </div>
  );
}
