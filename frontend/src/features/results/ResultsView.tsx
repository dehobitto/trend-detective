import { useEffect, useRef, useState } from 'react';
import type { Job } from '../../api/types';
import { Button } from '../../components/Button';
import { IconDownload } from '../../components/icons';
import { useStore } from '../../state/store';
import { CompareView } from './CompareView';
import { StatsTable } from './StatsTable';
import { TrendChart } from './TrendChart';
import { VerdictCard } from './VerdictCard';
import { downloadCsv } from './downloadCsv';
import './results.css';

export function ResultsView({ job }: { job: Job }) {
  const result = job.result;
  const [csvError, setCsvError] = useState<string | null>(null);
  const example = useStore((s) => s.activeExample);
  // Story extras only apply when the result is the example's own variable.
  const fromExample = example && result && example.variable_id === result.variable.id ? example : null;
  const top = useRef<HTMLDivElement>(null);
  // Bring the verdict into view when a new result lands.
  useEffect(() => {
    top.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }, [job.id]);
  if (!result) return null;
  // The "Demo data" badge already says this; don't repeat it as a warning.
  const warnings = result.warnings.filter((w) => !(result.synthetic && /^demo data/i.test(w)));
  const slug = `${result.variable.id.replace(/[^a-z0-9]+/gi, '-')}_${job.request.start.slice(0, 4)}-${job.request.end.slice(0, 4)}`;

  return (
    <div className="results" ref={top}>
      <VerdictCard result={result} takeaway={fromExample?.takeaway} />
      {warnings.length > 0 && (
        <ul className="warnings" aria-label="Warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <TrendChart result={result} />
      {fromExample?.related_variable_id && <CompareView key={job.id} job={job} relatedId={fromExample.related_variable_id} />}
      <details className="explainer">
        <summary>What does “significant” mean?</summary>
        <p>
          Climate data always wiggles. A trend is <em>significant</em> when wiggles alone would very rarely produce a slope this steep: the p-value is
          that chance, and we call it significant when it is below {result.stats.alpha} (1 in {Math.round(1 / result.stats.alpha)}).
        </p>
        <p>
          We ask two different tests, a straight-line t-test and the Mann-Kendall test, and only say “significant” when both agree. Significant does not
          mean large, and not significant does not prove there is no change; it may just need more years of data.
        </p>
      </details>
      <StatsTable result={result} />
      <div className="results__actions">
        <Button
          size="s"
          variant="quiet"
          onClick={() => downloadCsv(job.id, `trend-detective_${slug}.csv`).catch((e) => setCsvError(e instanceof Error ? e.message : 'Download failed.'))}
        >
          <IconDownload /> Download CSV
        </Button>
        <span className="hint">
          {result.variable.source}
          {result.synthetic ? ' · synthetic demo values' : ''}
        </span>
      </div>
      {csvError && <p className="field-error">{csvError}</p>}
    </div>
  );
}
