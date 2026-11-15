import { useEffect, useRef } from 'react';
import type { AnalysisResult, Job, Phenomenon, VariableExpectation } from '../../api/types';
import { fmtSigned, pText, unitSuffix } from '../../lib/format';
import { TrendChart } from './TrendChart';
import './results.css';

type Props = { phenomenon: Phenomenon; jobs: Record<string, Job | null> };

/** Does the actual result match what the phenomenon predicts? Uses stats.significant + stats.direction
 *  (what the user sees) rather than the robustness-adjusted assessment verdict. */
function matchesExpectation(expect: VariableExpectation['expect'], significant: boolean, direction: string): 'match' | 'mismatch' | 'unclear' {
  if (expect === 'significant_up') {
    if (significant && direction === 'rising') return 'match';
    if (significant && direction === 'falling') return 'mismatch';
    return 'unclear';
  }
  if (expect === 'significant_down') {
    if (significant && direction === 'falling') return 'match';
    if (significant && direction === 'rising') return 'mismatch';
    return 'unclear';
  }
  if (expect === 'not_significant') return !significant ? 'match' : 'mismatch';
  return 'unclear';
}

const MATCH_LABEL = { match: 'As expected', mismatch: 'Unexpected', unclear: 'Inconclusive' } as const;
const MATCH_ICON = { match: '✓', mismatch: '✗', unclear: '?' } as const;

function VariableResultCard({ ve, result }: { ve: VariableExpectation; result: AnalysisResult }) {
  const { stats, variable } = result;
  const match = matchesExpectation(ve.expect, stats.significant, stats.direction);
  const tone = stats.direction === 'rising' ? 'rise' : stats.direction === 'falling' ? 'fall' : 'flat';

  return (
    <div className="phen-result" data-match={match}>
      <div className="phen-result__head">
        <h4 className="phen-result__name">{variable.name}</h4>
        <span className={'phen-result__match phen-result__match--' + match} title={MATCH_LABEL[match]}>
          <span className="phen-result__match-icon">{MATCH_ICON[match]}</span>
          {MATCH_LABEL[match]}
        </span>
      </div>
      <p className="phen-result__role">{ve.role}</p>
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
      <div className="phen-result__expect">
        <span className={'phen-expect phen-expect--' + (ve.expect === 'not_significant' ? 'stable' : ve.expect.endsWith('_up') ? 'up' : 'down')}>
          {ve.expect_label}
        </span>
      </div>
      <TrendChart result={result} height={180} />
    </div>
  );
}

/** Overall assessment: how many variables matched their expectations? */
function PhenomenonVerdict({ phenomenon, results }: { phenomenon: Phenomenon; results: Map<string, AnalysisResult> }) {
  let matches = 0;
  let mismatches = 0;
  let unclear = 0;
  for (const ve of phenomenon.variables) {
    const r = results.get(ve.variable_id);
    if (!r) { unclear++; continue; }
    const m = matchesExpectation(ve.expect, r.stats.significant, r.stats.direction);
    if (m === 'match') matches++;
    else if (m === 'mismatch') mismatches++;
    else unclear++;
  }
  const total = phenomenon.variables.length;
  const allMatch = matches === total;
  const mostMatch = matches >= total * 0.6;

  let summary: string;
  if (allMatch) {
    summary = `All ${total} variables behave as predicted. Strong evidence for ${phenomenon.name.toLowerCase()}.`;
  } else if (mostMatch) {
    summary = `${matches} of ${total} variables match expectations. Partial evidence for ${phenomenon.name.toLowerCase()}.`;
  } else if (matches > 0) {
    summary = `Only ${matches} of ${total} variables match. The evidence is mixed.`;
  } else {
    summary = `None of the variables match expectations. The phenomenon is not clearly detectable in this area and period.`;
  }

  return (
    <section className="phen-verdict" data-strength={allMatch ? 'strong' : mostMatch ? 'partial' : 'weak'}>
      <h3 className="phen-verdict__title">Investigation result</h3>
      <p className="phen-verdict__hypothesis">{phenomenon.hypothesis}</p>
      <div className="phen-verdict__score">
        <span className="phen-verdict__n">{matches}/{total}</span>
        <span className="phen-verdict__label">variables match expectations</span>
      </div>
      <p className="phen-verdict__summary">{summary}</p>
      <div className="phen-verdict__legend">
        <span className="phen-verdict__legend-item phen-verdict__legend-item--match">
          <span className="phen-result__match-icon">✓</span> As expected
        </span>
        <span className="phen-verdict__legend-item phen-verdict__legend-item--mismatch">
          <span className="phen-result__match-icon">✗</span> Unexpected
        </span>
        <span className="phen-verdict__legend-item phen-verdict__legend-item--unclear">
          <span className="phen-result__match-icon">?</span> Inconclusive
        </span>
      </div>
    </section>
  );
}

export function PhenomenonResultsView({ phenomenon, jobs }: Props) {
  const top = useRef<HTMLDivElement>(null);

  // Scroll into view when results arrive.
  useEffect(() => {
    const el = top.current;
    const scroller = el?.closest('.panel__scroll');
    if (!el || !scroller) return;
    const y = scroller.scrollTop + el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12;
    scroller.scrollTo({ top: y, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, []);

  // Collect results.
  const results = new Map<string, AnalysisResult>();
  for (const ve of phenomenon.variables) {
    const j = jobs[ve.variable_id];
    if (j?.status === 'done' && j.result) results.set(ve.variable_id, j.result);
  }

  return (
    <div className="phen-results" ref={top}>
      <PhenomenonVerdict phenomenon={phenomenon} results={results} />
      {phenomenon.variables.map((ve) => {
        const r = results.get(ve.variable_id);
        if (!r) return null;
        return <VariableResultCard key={ve.variable_id} ve={ve} result={r} />;
      })}
    </div>
  );
}
