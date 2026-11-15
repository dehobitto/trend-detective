import { useEffect, useRef, useState } from 'react';
import type { Job } from '../../api/types';
import { Button } from '../../components/Button';
import { useStore } from '../../state/store';
import { JobProgress } from '../investigate/JobProgress';
import { pollAnalysis } from '../investigate/useRunAnalysis';
import { CaseBoard } from './DetectiveCase';
import { TrendChart } from './TrendChart';
import { VerdictCard } from './VerdictCard';

/**
 * "Compare with …": runs a second analysis for the same area and period with a related variable
 * (e.g. rainfall next to groundwater) and shows its verdict and chart underneath.
 */
export function CompareView({ job, relatedId, kid = false }: { job: Job; relatedId: string; kid?: boolean }) {
  const related = useStore((s) => s.variables.find((v) => v.id === relatedId));
  const [other, setOther] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const started = useRef(false);
  useEffect(() => {
    alive.current = true; // StrictMode mounts twice; re-arm after the first cleanup
    return () => void (alive.current = false);
  }, []);

  const running = !!other && other.status !== 'done' && other.status !== 'error';

  const run = async () => {
    started.current = true;
    setError(null);
    try {
      const done = await pollAnalysis({ ...job.request, variable_id: relatedId }, (j) => alive.current && setOther(j), () => !alive.current);
      if (done?.status === 'error') setError(done.message ?? 'The comparison failed.');
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'The comparison failed.');
    }
  };

  // Young detectives get the second clue automatically: the board is the point of the case.
  useEffect(() => {
    if (kid && related && !started.current) void run();
  });

  if (!related) return null;
  return (
    <section className="compare" aria-label={`Comparison with ${related.name}`}>
      {!other?.result && (
        <div className="compare__cta">
          <p className="notes notes--small">
            {job.request.bbox
              ? `Same area, same years, a different clue. If ${related.name.toLowerCase()} did not change, something else explains the trend above.`
              : `Same years, a second record. Does ${related.name.toLowerCase()} tell the same story?`}
          </p>
          <Button size="s" variant="quiet" onClick={run} disabled={running}>
            {running ? 'Comparing…' : `Compare with ${related.name.toLowerCase()}`}
          </Button>
          {running && other && <JobProgress job={other} />}
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {other?.result && (
        <div className="compare__result">
          {kid && job.result ? (
            <CaseBoard main={job.result} other={other.result} />
          ) : (
            <>
              <h3 className="compare__title">Compared with {related.name.toLowerCase()}</h3>
              <VerdictCard result={other.result} compact />
            </>
          )}
          <TrendChart result={other.result} height={150} />
        </div>
      )}
    </section>
  );
}
