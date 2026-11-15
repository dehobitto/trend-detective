import { useEffect } from 'react';
import { Button } from '../../components/Button';
import { needsNoArea, useStore } from '../../state/store';
import { MultiVariableResultsView } from '../results/MultiVariableResultsView';
import { PhenomenonResultsView } from '../results/PhenomenonResultsView';
import { PreviewView } from '../results/PreviewView';
import { ResultsView } from '../results/ResultsView';
import { AnalysisOptions } from './AnalysisOptions';
import { AreaStep } from './AreaStep';
import { DateRange } from './DateRange';
import { JobProgress } from './JobProgress';
import { PHENOMENA } from './phenomena';
import { Step } from './Step';
import { VariablePicker } from './VariablePicker';
import { useRunAnalysis } from './useRunAnalysis';
import { useRunMultiVariable, useRunPhenomenon } from './useRunPhenomenon';
import './investigate.css';

/** Right drawer (bottom sheet on phones): 1 Pick an area, 2 Choose a variable, 3 Read the trend. */
export function InvestigationPanel() {
  const bbox = useStore((s) => s.bbox);
  const variableId = useStore((s) => s.variableId);
  const selectedVariableIds = useStore((s) => s.selectedVariableIds);
  const pickerMode = useStore((s) => s.pickerMode);
  const phenomenonId = useStore((s) => s.phenomenonId);
  const job = useStore((s) => s.job);
  const phenomenonJobs = useStore((s) => s.phenomenonJobs);
  const phenomenonError = useStore((s) => s.phenomenonError);
  const runError = useStore((s) => s.runError);
  const runSingle = useRunAnalysis();
  const runPhenomenon = useRunPhenomenon();
  const runMulti = useRunMultiVariable();
  const collapsed = useStore((s) => s.panelCollapsed);
  const setCollapsed = (c: boolean) => useStore.getState().set({ panelCollapsed: c });
  useEffect(() => () => useStore.getState().set({ panelCollapsed: false }), []);

  const noArea = useStore(needsNoArea);
  const hasArea = !!bbox || noArea;

  const isPhenomenon = pickerMode === 'phenomenon' && !!phenomenonId;
  const isMultiVar = pickerMode === 'variable' && selectedVariableIds.length > 1;
  const isMultiMode = isPhenomenon || isMultiVar;
  const phenomenon = isPhenomenon ? PHENOMENA.find((p) => p.id === phenomenonId) : null;

  // Resolve variable IDs for the multi-run progress display.
  const multiVarIds = isPhenomenon
    ? (phenomenon?.variables.map((v) => v.variable_id) ?? [])
    : isMultiVar ? selectedVariableIds : [];

  // Single-variable mode state
  const running = !!job && job.status !== 'done' && job.status !== 'error';
  const done = job?.status === 'done' && job.result;
  const canRunSingle = hasArea && !!variableId && !running;

  // Multi-variable / phenomenon mode state
  const multiRunning = multiVarIds.some((vid) => {
    const j = phenomenonJobs[vid];
    return j && j.status !== 'done' && j.status !== 'error';
  });
  const multiDone = multiVarIds.length > 0 && multiVarIds.every((vid) => {
    const j = phenomenonJobs[vid];
    return j?.status === 'done' && j.result;
  });
  const multiHasAny = Object.keys(phenomenonJobs).length > 0;
  const canRunMulti = hasArea && multiVarIds.length > 0 && !multiRunning;

  // Combined
  const hasChoice = isPhenomenon ? !!phenomenonId : selectedVariableIds.length > 0;
  const isRunning = isMultiMode ? multiRunning : running;
  const isDone = isMultiMode ? multiDone : done;
  const canRun = isMultiMode ? canRunMulti : canRunSingle;
  const run = isPhenomenon ? runPhenomenon : isMultiVar ? runMulti : runSingle;
  const error = isMultiMode ? phenomenonError : runError;

  const pendingRun = useStore((s) => s.pendingRun);
  useEffect(() => {
    if (!pendingRun) return;
    useStore.getState().set({ pendingRun: false });
    if (canRun && !isMultiMode) runSingle();
  }, [pendingRun, canRun, isMultiMode, runSingle]);

  const variables = useStore((s) => s.variables);

  return (
    <aside className="panel" data-collapsed={collapsed} aria-label="Investigation">
      <button type="button" className="panel__grip" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
        <span aria-hidden className="panel__grip-bar" />
        <span className="sr-only">{collapsed ? 'Expand the investigation panel' : 'Collapse the investigation panel'}</span>
      </button>
      <div className="panel__scroll">
        <Step n={1} title={noArea ? 'No area needed' : 'Pick an area'} done={hasArea} active={!hasArea}>
          <AreaStep />
        </Step>
        <Step n={2} title={isPhenomenon ? 'Choose a phenomenon' : 'Choose a variable'} done={hasChoice} active={hasArea && !hasChoice}>
          <VariablePicker />
        </Step>
        <Step n={3} title="Read the trend" active={hasArea && hasChoice}>
          <div className="run">
            <DateRange />
            <AnalysisOptions />
            <Button variant="primary" className="run__btn" onClick={run} disabled={!canRun}>
              {isRunning ? 'Running…' : isDone ? 'Run again' : isMultiMode ? `Run ${multiVarIds.length} variables` : 'Run analysis'}
            </Button>
            {!hasArea && <p className="hint">Draw an area first, or choose a global record.</p>}
            {hasArea && !hasChoice && <p className="hint">{isPhenomenon ? 'Choose a phenomenon first.' : 'Choose a variable first.'}</p>}
            {/* Single variable progress */}
            {!isMultiMode && isRunning && job && <JobProgress job={job} />}
            {!isMultiMode && isRunning && job?.preview && <PreviewView result={job.preview} />}
            {/* Multi-variable progress */}
            {isMultiMode && multiHasAny && (
              <div className="phen-progress">
                {multiVarIds.map((vid) => {
                  const j = phenomenonJobs[vid];
                  const v = variables.find((x) => x.id === vid);
                  const label = v?.name ?? vid;
                  if (!j) return <p key={vid} className="hint">{label}: waiting…</p>;
                  const jDone = j.status === 'done';
                  const jError = j.status === 'error';
                  return (
                    <div key={vid} className="phen-progress__var">
                      <span className="phen-progress__name">{label}</span>
                      <span className={'phen-progress__status' + (jDone ? ' phen-progress__status--done' : jError ? ' phen-progress__status--error' : '')}>
                        {jDone ? '✓' : jError ? '✗' : `${Math.round(j.progress * 100)}%`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
          </div>
          {/* Single variable results */}
          {!isMultiMode && done && job && <ResultsView job={job} />}
          {/* Phenomenon results (with expectation matching) */}
          {isPhenomenon && phenomenon && multiDone && <PhenomenonResultsView phenomenon={phenomenon} jobs={phenomenonJobs} />}
          {/* Multi-variable results (no expectations) */}
          {isMultiVar && multiDone && <MultiVariableResultsView variableIds={selectedVariableIds} jobs={phenomenonJobs} />}
        </Step>
      </div>
    </aside>
  );
}
