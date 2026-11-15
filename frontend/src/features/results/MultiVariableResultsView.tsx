import { useEffect, useRef } from 'react';
import type { AnalysisResult, Job } from '../../api/types';
import { fmtSigned, pText, unitSuffix } from '../../lib/format';
import { TrendChart } from './TrendChart';
import './results.css';

type Props = { variableIds: string[]; jobs: Record<string, Job | null> };

function VariableResultCard({ result }: { result: AnalysisResult }) {
  const { stats, variable } = result;
  const tone = stats.direction === 'rising' ? 'rise' : stats.direction === 'falling' ? 'fall' : 'flat';

  return (
    <div className="phen-result">
      <div className="phen-result__head">
        <h4 className="phen-result__name">{variable.name}</h4>
        <span className={'phen-result__match phen-result__match--' + (stats.significant ? (stats.direction === 'rising' ? 'up' : 'down') : 'flat')}>
          {stats.significant ? 'Significant' : 'Not significant'}
        </span>
      </div>
      <div className="phen-result__verdict" data-tone={tone}>
        <span className="phen-result__dir">
          {stats.direction === 'rising' ? 'Rising' : stats.direction === 'falling' ? 'Falling' : 'Flat'}
        </span>
        <span className="phen-result__rate">
          {fmtSigned(stats.slope_per_decade)}{unitSuffix(variable.units)}/decade
        </span>
        <span className="phen-result__sig">
          {stats.significant ? 'Significant' : 'Not significant'} ({pText(stats.mk_p_value)})
        </span>
      </div>
      <TrendChart result={result} height={180} />
    </div>
  );
}

function MultiSummary({ results }: { results: AnalysisResult[] }) {
  const sigUp = results.filter((r) => r.stats.significant && r.stats.direction === 'rising').length;
  const sigDown = results.filter((r) => r.stats.significant && r.stats.direction === 'falling').length;
  const notSig = results.filter((r) => !r.stats.significant).length;
  return (
    <section className="phen-verdict" data-strength={sigUp + sigDown === results.length ? 'strong' : 'partial'}>
      <h3 className="phen-verdict__title">Results for {results.length} variables</h3>
      <div className="multi-summary-chips">
        {sigUp > 0 && <span className="multi-chip multi-chip--up">{sigUp} rising</span>}
        {sigDown > 0 && <span className="multi-chip multi-chip--down">{sigDown} falling</span>}
        {notSig > 0 && <span className="multi-chip multi-chip--flat">{notSig} not significant</span>}
      </div>
    </section>
  );
}

export function MultiVariableResultsView({ variableIds, jobs }: Props) {
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = top.current;
    const scroller = el?.closest('.panel__scroll');
    if (!el || !scroller) return;
    const y = scroller.scrollTop + el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12;
    scroller.scrollTo({ top: y, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, []);

  const results: AnalysisResult[] = [];
  for (const vid of variableIds) {
    const j = jobs[vid];
    if (j?.status === 'done' && j.result) results.push(j.result);
  }

  return (
    <div className="phen-results" ref={top}>
      <MultiSummary results={results} />
      {variableIds.map((vid) => {
        const j = jobs[vid];
        if (!j?.result) return null;
        return <VariableResultCard key={vid} result={j.result} />;
      })}
    </div>
  );
}
