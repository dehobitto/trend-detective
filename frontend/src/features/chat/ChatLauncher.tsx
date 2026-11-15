import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { ChatDrawer } from './ChatDrawer';
import { CURIOUS_QUESTIONS } from './questions';
import './chat.css';

/** Tilt toward the pointer, and sink at the point that is pressed (a soft physical card). */
const pressable = {
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    const k = el.dataset.pressed === 'true' ? 9 : 4;
    el.style.setProperty('--rx', `${(-ny * k).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${(nx * k).toFixed(2)}deg`);
  },
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
    e.currentTarget.dataset.pressed = 'true';
    pressable.onPointerMove(e);
  },
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
    e.currentTarget.dataset.pressed = 'false';
  },
  onPointerLeave: (e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    el.dataset.pressed = 'false';
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  },
};

/**
 * The chat button, centred near the bottom. It opens four ready-made questions and a field to ask your own;
 * either opens the field guide chat with the question asked.
 */
export function ChatLauncher({ besidePanel, onMap = false }: { besidePanel: boolean; onMap?: boolean }) {
  const open = useStore((s) => s.chatOpen);
  const set = useStore((s) => s.set);
  const [picker, setPicker] = useState(false);
  const [question, setQuestion] = useState<string | null>(null);
  // "Ask the field guide about this result" and similar links elsewhere open the chat through the store.
  const chatAsk = useStore((s) => s.chatAsk);
  useEffect(() => {
    if (!chatAsk) return;
    setQuestion(chatAsk);
    setPicker(false);
    set({ chatAsk: null, chatOpen: true });
  }, [chatAsk, set]);
  const root = useRef<HTMLDivElement>(null);
  const [own, setOwn] = useState('');

  useEffect(() => {
    if (!picker) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !root.current?.contains(e.target as Node)) setPicker(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [picker]);

  const ask = (q: string | null) => {
    setOwn('');
    setQuestion(q);
    setPicker(false);
    set({ chatOpen: true });
  };

  return (
    <div className="chat-dock" data-beside-panel={besidePanel} data-on-map={onMap} ref={root}>
      {open && (
        <ChatDrawer
          key={question ?? 'free'}
          initialQuestion={question}
          onClose={() => {
            set({ chatOpen: false });
            setQuestion(null);
          }}
        />
      )}
      {picker && !open && (
        <div className="curious" role="menu" aria-label="Curious questions">
          {CURIOUS_QUESTIONS.slice(0, 4).map((q) => (
            <button key={q} type="button" role="menuitem" className="curious__q" onClick={() => ask(q)} {...pressable}>
              {q}
            </button>
          ))}
          <form
            className="chat__pill curious__input"
            onSubmit={(e) => {
              e.preventDefault();
              if (own.trim()) ask(own.trim());
            }}
          >
            <input value={own} onChange={(e) => setOwn(e.target.value)} placeholder="Ask about Earth" aria-label="Your question" autoFocus />
            <button type="submit" className="chat__send" disabled={!own.trim()} aria-label="Ask">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
              </svg>
            </button>
          </form>
        </div>
      )}
      <div className="curious-launch">
        {!open && !picker && <span className="curious-launch__label">Curious about Earth?</span>}
        <button
          type="button"
          className="orb"
          data-open={open || picker}
          aria-expanded={open || picker}
          aria-label={open ? 'Close the field guide' : picker ? 'Close questions' : 'Curious questions about Earth'}
          onClick={() => (open ? set({ chatOpen: false }) : setPicker(!picker))}
        >
          <svg className="orb__chat" width="24" height="24" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 11.5c0 4.1-3.6 7.5-8 7.5-1.2 0-2.3-.2-3.3-.6L4 19.5l1.2-3.6C4.4 14.7 4 13.2 4 11.5 4 7.4 7.6 4 12 4s8 3.4 8 7.5z" />
            <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" strokeWidth="2.4" />
          </svg>
          <svg className="orb__x" width="20" height="20" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  );
}
