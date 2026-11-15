import type { AnalysisResult } from '../../api/types';
import { TrendChart } from './TrendChart';
import { VerdictCard } from './VerdictCard';
import './results.css';

/**
 * A preliminary result while a big download is still running (night lights over a large area): yearly points
 * from the months downloaded so far. Same area and quantity as the final answer, only sparser, and labelled so.
 */
export function PreviewView({ result }: { result: AnalysisResult }) {
  const [note, ...rest] = result.warnings;
  return (
    <section className="preview" aria-label="Preliminary result" aria-live="polite">
      <p className="preview__label">Preliminary result, still downloading</p>
      {note && <p className="preview__note">{note}</p>}
      <VerdictCard result={result} compact />
      {rest.length > 0 && (
        <ul className="warnings" aria-label="Warnings">
          {rest.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <TrendChart result={result} height={170} />
    </section>
  );
}
