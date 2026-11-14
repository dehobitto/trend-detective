import { useEffect, useRef, useState } from 'react';
import { IconClose, IconSend } from '../../components/icons';
import { useStore } from '../../state/store';
import { chatAdapter, type ChatMessage } from './chatAdapter';

const GREETING: ChatMessage = {
  role: 'assistant',
  content: 'Hi, I’m your field guide. Ask me what a variable means, why a trend might not be significant, or what to investigate next.',
};

export function ChatDrawer({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [stub, setStub] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const send = async () => {
    const content = text.trim();
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
    <section className="chat" role="dialog" aria-label="Field guide chat" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <header className="chat__head">
        <div>
          <h2 className="chat__title">Field guide</h2>
          {stub && <p className="hint">Placeholder answers for now.</p>}
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close chat">
          <IconClose />
        </button>
      </header>
      <div className="chat__list" ref={list} aria-live="polite">
        {messages.map((m, i) => (
          <p key={i} className={`msg msg--${m.role}`}>
            {m.content}
          </p>
        ))}
        {busy && <p className="msg msg--assistant msg--typing">Thinking…</p>}
        {error && <p className="field-error">{error}</p>}
      </div>
      <form
        className="chat__form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          ref={inputRef}
          rows={2}
          value={text}
          placeholder="Ask a question"
          aria-label="Your question"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="submit" className="icon-btn icon-btn--solid" disabled={!text.trim() || busy} aria-label="Send">
          <IconSend />
        </button>
      </form>
    </section>
  );
}
