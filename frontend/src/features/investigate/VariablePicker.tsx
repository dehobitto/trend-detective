import { useEffect, useState } from 'react';
import { type Phenomenon, type Sphere, type Variable } from '../../api/types';
import { Button } from '../../components/Button';
import { Segmented } from '../../components/Segmented';
import { useStore } from '../../state/store';
import { PHENOMENA } from './phenomena';

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

function VariableOption({ v, selected, onSelect, checkbox }: { v: Variable; selected: boolean; onSelect: () => void; checkbox?: boolean }) {
  const [info, setInfo] = useState(false);
  return (
    <div className="var-row">
      <div className="var-row__line">
        <button type="button" role={checkbox ? 'checkbox' : 'radio'} aria-checked={selected} className="var-opt" onClick={onSelect}>
          {checkbox && <span className={'var-check' + (selected ? ' var-check--on' : '')} aria-hidden />}
          <span className="var-opt__name">{v.name}</span>
          <span className="var-opt__units">{v.units === 'unitless' ? years(v) : `${v.units} · ${years(v)}`}</span>
        </button>
        <InfoToggle open={info} onToggle={() => setInfo(!info)} label={v.name} />
      </div>
      {info && <VariableDetails v={v} />}
    </div>
  );
}

/* ------------------------------------------------------------------ Phenomenon picker */

function PhenomenonOption({ ph, selected, onSelect }: { ph: Phenomenon; selected: boolean; onSelect: () => void }) {
  const [info, setInfo] = useState(false);
  const variables = useStore((s) => s.variables);
  return (
    <div className="phen-row">
      <div className="phen-row__line">
        <button type="button" role="radio" aria-checked={selected} className="phen-opt" onClick={onSelect}>
          <span className="phen-opt__name">{ph.name}</span>
          <span className="phen-opt__tagline">{ph.tagline}</span>
        </button>
        <InfoToggle open={info} onToggle={() => setInfo(!info)} label={ph.name} />
      </div>
      {info && (
        <div className="phen-info">
          <p>{ph.description}</p>
          <div className="phen-info__vars">
            {ph.variables.map((ve) => {
              const v = variables.find((x) => x.id === ve.variable_id);
              return (
                <div key={ve.variable_id} className="phen-info__var">
                  <div className="phen-info__var-head">
                    <strong>{v?.name ?? ve.variable_id}</strong>
                    <span className={'phen-expect phen-expect--' + (ve.expect === 'not_significant' ? 'stable' : ve.expect.endsWith('_up') ? 'up' : 'down')}>
                      {ve.expect_label}
                    </span>
                  </div>
                  <p className="phen-info__var-role">{ve.role}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PhenomenonSelected({ ph }: { ph: Phenomenon }) {
  const [info, setInfo] = useState(false);
  const variables = useStore((s) => s.variables);
  return (
    <div className="var-selected">
      <div className="var-selected__head">
        <strong>{ph.name}</strong>
        <InfoToggle open={info} onToggle={() => setInfo(!info)} label={ph.name} />
        <Button size="s" variant="ghost" onClick={() => useStore.getState().set({ phenomenonId: null })}>
          Change
        </Button>
      </div>
      <p className="var-opt__units">{ph.tagline}</p>
      <p className="phen-vars-list">
        {ph.variables.map((ve, i) => {
          const v = variables.find((x) => x.id === ve.variable_id);
          return (
            <span key={ve.variable_id}>
              {i > 0 && ' · '}
              {v?.name ?? ve.variable_id}
            </span>
          );
        })}
      </p>
      {info && (
        <div className="phen-info" style={{ padding: 0 }}>
          <p>{ph.description}</p>
          <div className="phen-info__vars">
            {ph.variables.map((ve) => {
              const v = variables.find((x) => x.id === ve.variable_id);
              return (
                <div key={ve.variable_id} className="phen-info__var">
                  <div className="phen-info__var-head">
                    <strong>{v?.name ?? ve.variable_id}</strong>
                    <span className={'phen-expect phen-expect--' + (ve.expect === 'not_significant' ? 'stable' : ve.expect.endsWith('_up') ? 'up' : 'down')}>
                      {ve.expect_label}
                    </span>
                  </div>
                  <p className="phen-info__var-role">{ve.role}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Variable list with multi-select */

function VariableSelectedSummary({ ids, onOpen }: { ids: string[]; onOpen: () => void }) {
  const variables = useStore((s) => s.variables);
  const names = ids.map((id) => variables.find((v) => v.id === id)?.name ?? id);
  return (
    <div className="var-selected">
      <div className="var-selected__head">
        <strong>{ids.length === 1 ? names[0] : `${ids.length} variables`}</strong>
        <Button size="s" variant="ghost" onClick={onOpen}>Change</Button>
      </div>
      {ids.length > 1 && <p className="phen-vars-list">{names.join(' · ')}</p>}
      {ids.length === 1 && (() => {
        const v = variables.find((x) => x.id === ids[0]);
        return v ? <p className="var-opt__units">{v.units === 'unitless' ? years(v) : `${v.units} · ${years(v)}`}</p> : null;
      })()}
    </div>
  );
}

function VariableList() {
  const variables = useStore((s) => s.variables);
  const selectedIds = useStore((s) => s.selectedVariableIds);
  const toggleVariable = useStore((s) => s.toggleVariable);
  const catalogError = useStore((s) => s.catalogError);
  const [open, setOpen] = useState(selectedIds.length === 0);

  useEffect(() => {
    if (selectedIds.length === 0) setOpen(true);
  }, [selectedIds.length]);

  if (catalogError) return <p className="field-error">{catalogError}</p>;

  if (!open && selectedIds.length > 0) {
    return <VariableSelectedSummary ids={selectedIds} onOpen={() => setOpen(true)} />;
  }

  return (
    <div className="var-picker">
      {selectedIds.length > 0 && (
        <div className="var-picker__bar">
          <span className="hint">{selectedIds.length} selected</span>
          <Button size="s" variant="ghost" onClick={() => setOpen(false)}>Done</Button>
        </div>
      )}
      {variables.length === 0 && <p className="hint">Loading variables…</p>}
      {SPHERES.map((s) => {
        const group = variables.filter((v) => v.sphere === s.id);
        if (!group.length) return null;
        return (
          <div key={s.id} className="var-group">
            <h3 className="var-group__title">{s.label}</h3>
            {group.map((v) => (
              <VariableOption key={v.id} v={v} selected={selectedIds.includes(v.id)} onSelect={() => toggleVariable(v.id)} checkbox />
            ))}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ Phenomenon list */

function PhenomenonList() {
  const phenomenonId = useStore((s) => s.phenomenonId);
  const selectPhenomenon = useStore((s) => s.selectPhenomenon);
  const [open, setOpen] = useState(!phenomenonId);

  useEffect(() => {
    if (!phenomenonId) setOpen(true);
  }, [phenomenonId]);

  const selected = PHENOMENA.find((p) => p.id === phenomenonId);

  const choose = (ph: Phenomenon) => {
    selectPhenomenon(ph);
    setOpen(false);
  };

  if (!open && selected) {
    return <PhenomenonSelected ph={selected} />;
  }

  return (
    <div className="var-picker" role="radiogroup" aria-label="Phenomenon">
      {PHENOMENA.map((ph) => (
        <PhenomenonOption key={ph.id} ph={ph} selected={ph.id === phenomenonId} onSelect={() => choose(ph)} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ Main picker with toggle */

type PickerMode = 'variable' | 'phenomenon';

/** Variable choice, grouped by Earth sphere, or phenomenon (multi-variable investigation). */
export function VariablePicker() {
  const mode = useStore((s) => s.pickerMode);
  const setMode = useStore((s) => s.setPickerMode);

  return (
    <div className="picker-wrap">
      <div className="picker-toggle">
        <Segmented<PickerMode>
          label="Picker mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'variable', label: 'Variable' },
            { value: 'phenomenon', label: 'Phenomenon' },
          ]}
        />
      </div>
      {mode === 'variable' ? <VariableList /> : <PhenomenonList />}
    </div>
  );
}
