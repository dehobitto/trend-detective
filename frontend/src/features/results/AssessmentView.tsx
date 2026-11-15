import type { TrendAssessment } from '../../api/types';
import { fmt } from '../../lib/format';

const VERDICT: Record<TrendAssessment['verdict'], string> = {
  significant_up: 'Rising, confirmed',
  significant_down: 'Falling, confirmed',
  not_significant: 'No clear trend',
  ambiguous: 'Mixed evidence',
  insufficient_data: 'Not enough data',
};

const pct = (x: number | null) => (x === null ? null : `${Math.round(x * 100)}%`);

/** Trend significance check based on Mann-Kendall TFPW + sensitivity analysis. */
export function AssessmentView({ a }: { a: TrendAssessment }) {
  const same = pct(a.robust_same_sign);
  const mk = a.tests[0];
  return (
    <section className="assess" aria-label="Trend significance">
      <div className="assess__head">
        <span className="assess__title">Trend significance</span>
        <span className="assess__verdict" data-verdict={a.verdict}>
          {VERDICT[a.verdict]}
        </span>
      </div>
      <p className="assess__line">
        Mann-Kendall TFPW:
        {mk ? <> slope {mk.estimate === null ? '–' : fmt(mk.estimate)}/yr, <em>p</em>&nbsp;=&nbsp;{mk.p_value === null ? '–' : mk.p_value < 0.001 ? '<0.001' : fmt(mk.p_value, 2)}</> : ' –'}
        , {a.confidence} confidence
        {same ? `. Consistent direction in ${same} of trimmed and resampled versions` : ''}
      </p>
    </section>
  );
}
