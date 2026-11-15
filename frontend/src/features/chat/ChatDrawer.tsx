import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { chatAdapter, type ChatMessage } from './chatAdapter';
import { Markdown } from './Markdown';

const GREETING: ChatMessage = {
  role: 'assistant',
  content: 'Hi, I’m your field guide. Ask me what a variable means, why a trend might not be significant, or what to investigate next.',
};

export function ChatDrawer({
  onClose,
  onMinimize,
  initialQuestion = null,
}: {
  onClose: () => void;
  onMinimize: () => void;
  initialQuestion?: string | null;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [stub, setStub] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => inputRef.current?.focus(), []);
  // A ready-made question from the launcher: ask it straight away.
  const asked = useRef(false);
  useEffect(() => {
    if (initialQuestion && !asked.current) {
      asked.current = true;
      void send(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const send = async (preset?: string) => {
    const content = (preset ?? text).trim();
    if (!content || busy) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setText('');
    setBusy(true);
    setError(null);
    const s = useStore.getState();
    try {
      const res = await chatAdapter.send({
        messages: next.filter((m) => m !== GREETING),
        context: { bbox: s.bbox, variable_id: s.variableId, result_summary: s.job?.result?.summary ?? null },
      });
      setStub(res.stub);
      setMessages((m) => [...m, res.message]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The field guide did not answer. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="chat" role="dialog" aria-label="Field guide chat" onKeyDown={(e) => e.key === 'Escape' && onMinimize()}>
      <div className="chat__bar">
        <button type="button" className="chat__barbtn" onClick={onMinimize} aria-label="Minimize the chat" title="Minimize (keeps the conversation)">
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3.5 8h9" />
          </svg>
        </button>
        <button type="button" className="chat__barbtn" onClick={onClose} aria-label="Close the chat" title="Close (clears the conversation)">
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <div className="chat__list" ref={list} aria-live="polite">
        {messages.map((m, i) => (
          m.role === 'assistant' ? (
            <div key={i} className="bubble bubble--assistant bubble--md">
              <Markdown text={m.content} />
            </div>
          ) : (
            <p key={i} className={`bubble bubble--${m.role}`}>
              {m.content}
            </p>
          )
        ))}
        {busy && (
          <p className="bubble bubble--assistant bubble--typing" aria-label="Thinking">
            <span />
            <span />
            <span />
          </p>
        )}
        {error && <p className="bubble bubble--error">{error}</p>}
      </div>
      {stub && <p className="chat__note">Placeholder answers for now.</p>}
      <form
        className="chat__pill"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          placeholder="Ask about Earth…"
          aria-label="Your question"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" className="chat__send" disabled={!text.trim() || busy} aria-label="Send">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
          </svg>
        </button>
      </form>
    </section>
  );
}
