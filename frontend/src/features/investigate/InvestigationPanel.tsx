import { useEffect } from 'react';
import { AudienceSwitch } from '../../components/AudienceSwitch';
import { Button } from '../../components/Button';
import { needsNoArea, useStore } from '../../state/store';
import { ResultsView } from '../results/ResultsView';
import { AnalysisOptions } from './AnalysisOptions';
import { AreaStep } from './AreaStep';
import { DateRange } from './DateRange';
import { JobProgress } from './JobProgress';
import { Step } from './Step';
import { VariablePicker } from './VariablePicker';
import { useRunAnalysis } from './useRunAnalysis';
import './investigate.css';

/** Right drawer (bottom sheet on phones): 1 Pick an area, 2 Choose a variable, 3 Read the trend. */
export function InvestigationPanel() {
  const bbox = useStore((s) => s.bbox);
  const variableId = useStore((s) => s.variableId);
  const job = useStore((s) => s.job);
  const runError = useStore((s) => s.runError);
  const run = useRunAnalysis();
  const collapsed = useStore((s) => s.panelCollapsed);
  const setCollapsed = (c: boolean) => useStore.getState().set({ panelCollapsed: c });
  // A fresh panel always opens unfolded.
  useEffect(() => () => useStore.getState().set({ panelCollapsed: false }), []);

  const noArea = useStore(needsNoArea);
  const hasArea = !!bbox || noArea;
  const running = !!job && job.status !== 'done' && job.status !== 'error';
  const done = job?.status === 'done' && job.result;
  const canRun = hasArea && !!variableId && !running;

  // "Show the global record" from the guided start: run as soon as the panel is up.
  const pendingRun = useStore((s) => s.pendingRun);
  useEffect(() => {
    if (!pendingRun) return;
    useStore.getState().set({ pendingRun: false });
    if (canRun) run();
  }, [pendingRun, canRun, run]);

  return (
    <aside className="panel" data-collapsed={collapsed} aria-label="Investigation">
      <button type="button" className="panel__grip" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
        <span aria-hidden className="panel__grip-bar" />
        <span className="sr-only">{collapsed ? 'Expand the investigation panel' : 'Collapse the investigation panel'}</span>
      </button>
      <AudienceSwitch className="audience--panel" />
      <div className="panel__scroll">
        <Step n={1} title={noArea ? 'No area needed' : 'Pick an area'} done={hasArea} active={!hasArea}>
          <AreaStep />
        </Step>
        <Step n={2} title="Choose a variable" done={!!variableId} active={hasArea && !variableId}>
          <VariablePicker />
        </Step>
        <Step n={3} title="Read the trend" active={hasArea && !!variableId}>
          <div className="run">
            <DateRange />
            <AnalysisOptions />
            <Button variant="primary" className="run__btn" onClick={run} disabled={!canRun}>
              {running ? 'Running…' : done ? 'Run again' : 'Run analysis'}
            </Button>
            {!hasArea && <p className="hint">Draw an area first, or choose a global record.</p>}
            {hasArea && !variableId && <p className="hint">Choose a variable first.</p>}
            {running && job && <JobProgress job={job} />}
            {runError && (
              <p className="field-error" role="alert">
                {runError}
              </p>
            )}
          </div>
          {done && job && <ResultsView job={job} />}
        </Step>
      </div>
    </aside>
  );
}
