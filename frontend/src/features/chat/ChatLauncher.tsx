import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { ChatDrawer } from './ChatDrawer';
import { CURIOUS_QUESTIONS } from './questions';
import './chat.css';

/**
 * Bottom-right: a round button with a small label. It opens four ready-made curious questions; picking one
 * opens the field guide chat with that question already asked (or "Ask your own"). Shifts left of the panel.
 */
export function ChatLauncher({ besidePanel }: { besidePanel: boolean }) {
  const open = useStore((s) => s.chatOpen);
  const set = useStore((s) => s.set);
  const [picker, setPicker] = useState(false);
  const [question, setQuestion] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

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
    setQuestion(q);
    setPicker(false);
    set({ chatOpen: true });
  };

  return (
    <div className="chat-dock" data-beside-panel={besidePanel} ref={root}>
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
            <button key={q} type="button" role="menuitem" className="curious__q" onClick={() => ask(q)}>
              {q}
            </button>
          ))}
          <button type="button" role="menuitem" className="curious__own" onClick={() => ask(null)}>
            Ask your own question
          </button>
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
          <span className="orb__earth" aria-hidden />
          <span className="orb__shine" aria-hidden />
          <svg className="orb__x" width="18" height="18" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  );
}
