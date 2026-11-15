import type { AnalysisResult } from '../../api/types';

/**
 * "What does this mean?" under the verdict. The interpretation will come from the AI field guide (the
 * teammate's chatbot, see `features/chat/chatAdapter.ts` and backend `TD_CHAT_BACKEND`): give it the
 * result (variable, area, period, stats, summary, warnings) and render its answer here. Until then this is
 * a placeholder: no fixed text, because a fixed takeaway can contradict the chart once dates or area change.
 */
export function AiInsight({ result }: { result: AnalysisResult }) {
  void result; // the AI will read it
  return (
    <p className="verdict__takeaway" data-placeholder="ai">
      What does this mean? The AI field guide will explain this result here.
    </p>
  );
}
