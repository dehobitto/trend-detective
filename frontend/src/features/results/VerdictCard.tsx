import type { AnalysisResult } from '../../api/types';
import { Badge } from '../../components/Badge';
import { fmtSigned, unitSuffix } from '../../lib/format';
import { AiInsight } from './AiInsight';

const WORD = { rising: 'Rising', falling: 'Falling', flat: 'Flat' } as const;

/** The answer, first: direction + rate in the trend colour, the plain-English summary, then the AI's reading. */
export function VerdictCard({ result, compact = false }: { result: AnalysisResult; compact?: boolean }) {
  const { stats, variable } = result;
  const tone = stats.direction === 'rising' ? 'rise' : stats.direction === 'falling' ? 'fall' : 'flat';
  return (
    <section className="verdict" data-tone={tone} data-compact={compact} aria-label="Verdict">
      <div className="verdict__head">
        <span className="verdict__dir">{WORD[stats.direction]}</span>
        <span className="verdict__rate">
          {fmtSigned(stats.slope_per_decade)}
          <span className="verdict__unit">
            {unitSuffix(variable.units)} per decade
          </span>
        </span>
      </div>
      <p className="verdict__summary">{result.summary}</p>
      {!compact && <AiInsight result={result} />}
      <div className="verdict__badges">
        <Badge title={stats.significant ? 'Both tests agree the trend is unlikely to be chance' : 'The tests could not rule out chance'}>
          <svg width="18" height="6" aria-hidden>
            <line x1="0" y1="3" x2="18" y2="3" stroke="currentColor" strokeWidth="2" strokeDasharray={stats.significant ? undefined : '4 3'} />
          </svg>
          {stats.significant ? 'Significant' : 'Not significant'}
        </Badge>
        {result.provider === 'upload' && <Badge>Your data</Badge>}
      </div>
    </section>
  );
}
