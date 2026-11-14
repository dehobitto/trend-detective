import type { AnalysisResult } from '../../api/types';
import { fmt, fmtP, fmtSigned, pText, unitSuffix } from '../../lib/format';

/** The numbers behind the verdict, each with a short plain-language gloss. */
export function StatsTable({ result }: { result: AnalysisResult }) {
  const { stats: s, variable, series } = result;
  const u = unitSuffix(variable.units);
  const period = series.length ? `${series[0].date.slice(0, 7)} to ${series[series.length - 1].date.slice(0, 7)}` : '–';
  const rows: { k: string; v: string; gloss: string }[] = [
    {
      k: 'Rate of change',
      v: `${fmtSigned(s.slope_per_decade)} ± ${fmt((s.slope_ci_high_per_decade - s.slope_ci_low_per_decade) / 2)}${u} per decade`,
      gloss: `Straight-line fit. ${Math.round((1 - s.alpha) * 100)}% range: ${fmt(s.slope_ci_low_per_decade)} to ${fmt(s.slope_ci_high_per_decade)}.`,
    },
    { k: 't-test p-value', v: fmtP(s.p_value), gloss: `Chance of a slope this steep if there were no trend. t = ${fmt(s.t_stat)}.` },
    { k: 'Mann-Kendall', v: `τ = ${fmt(s.mk_tau)}, ${pText(s.mk_p_value)}`, gloss: 'Counts ups vs downs. Robust to outliers and odd shapes.' },
    { k: "Sen's slope", v: `${fmtSigned(s.sens_slope_per_decade)}${u} per decade`, gloss: 'Median of all pairwise slopes; a cross-check on the rate.' },
    {
      k: 'Total change',
      v: `${fmtSigned(s.total_change)}${u}${s.percent_change !== null ? ` (${fmtSigned(s.percent_change, 2)}%)` : ''}`,
      gloss: 'Over the whole period, along the trend line.',
    },
    { k: 'Fit (R²)', v: fmt(s.r_squared), gloss: 'Share of the ups and downs the straight line explains.' },
    { k: 'Data points', v: `${s.n}`, gloss: period },
  ];
  return (
    <dl className="stats">
      {rows.map((r) => (
        <div key={r.k} className="stats__row">
          <dt>{r.k}</dt>
          <dd>
            <span className="stats__v">{r.v}</span>
            <span className="stats__gloss">{r.gloss}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
