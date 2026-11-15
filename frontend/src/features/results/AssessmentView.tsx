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

/** The robustness check: one line that sums up many tests, the full table one click away. */
export function AssessmentView({ a }: { a: TrendAssessment }) {
  const same = pct(a.robust_same_sign);
  return (
    <section className="assess" aria-label="Robustness check">
      <div className="assess__head">
        <span className="assess__title">Robustness check</span>
        <span className="assess__verdict" data-verdict={a.verdict}>
          {VERDICT[a.verdict]}
        </span>
      </div>
      <p className="assess__line">
        {a.tests_significant} of {a.tests_voting} independent tests find a significant trend, {a.confidence} confidence
        {same ? `. Same direction in ${same} of trimmed and resampled versions of the record` : ''}
      </p>
      <details className="assess__more">
        <summary>All tests</summary>
        <table className="assess__table">
          <thead>
            <tr>
              <th>Test</th>
              <th>Slope</th>
              <th>p</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {a.tests.map((t) => (
              <tr key={t.name} data-voting={t.voting}>
                <td>{t.name}</td>
                <td>{t.estimate === null ? '–' : fmt(t.estimate)}</td>
                <td>{t.p_value === null ? '–' : t.p_value < 0.001 ? '<0.001' : fmt(t.p_value, 2)}</td>
                <td className="assess__mark">{t.significant ? (t.direction === 'down' ? '▼' : t.direction === 'up' ? '▲' : '●') : '·'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="assess__note">Slopes are per year. Dimmed rows are for reference and are not counted.</p>
      </details>
    </section>
  );
}
