import { useEffect, useState } from 'react';
import type { AnalysisResult } from '../../api/types';
import { useStore } from '../../state/store';
import { chatAdapter } from '../chat/chatAdapter';

const ASK = 'Explain this result in two or three plain sentences for a high-school student: what changed, how sure we can be, and one thing to keep in mind.';

/** What the field guide needs to explain a result: the summary plus the multi-test verdict and the caveats. */
function describe(r: AnalysisResult): string {
  const a = r.assessment;
  return [
    `${r.variable.name} (${r.variable.units})${r.region_name ? ` in ${r.region_name}` : ''}: ${r.summary}`,
    a ? `Multi-test check: ${a.verdict.replace('_', ' ')}, ${a.confidence} confidence, ${a.tests_significant} of ${a.tests_voting} tests significant.` : '',
    r.warnings.length ? `Caveats: ${r.warnings.join(' ')}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** The field guide's explanation under the verdict; a link to ask it when no LLM is connected. */
export function AiInsight({ result }: { result: AnalysisResult }) {
  const [state, setState] = useState<{ text: string } | 'loading' | 'unavailable'>('loading');
  const bbox = useStore((s) => s.bbox);
  const askChat = (q: string) => useStore.getState().set({ chatAsk: q });

  useEffect(() => {
    let alive = true;
    setState('loading');
    chatAdapter
      .send({ messages: [{ role: 'user', content: ASK }], context: { bbox, variable_id: result.variable.id, result_summary: describe(result) } })
      .then((res) => alive && setState(res.stub ? 'unavailable' : { text: res.message.content }))
      .catch(() => alive && setState('unavailable'));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  if (state === 'loading') return <p className="ai-insight ai-insight--loading">Asking the field guide…</p>;
  if (state === 'unavailable') {
    return (
      <button type="button" className="ai-insight__ask" onClick={() => askChat('What does this result mean?')}>
        Ask the field guide about this result
      </button>
    );
  }
  return (
    <div className="ai-insight">
      <p>{state.text}</p>
      <button type="button" className="ai-insight__ask" onClick={() => askChat('Tell me more about this result.')}>
        Ask a follow-up
      </button>
    </div>
  );
}
