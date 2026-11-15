import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { pressable } from '../../components/pressable';
import { ChatDrawer } from './ChatDrawer';
import { CURIOUS_QUESTIONS } from './questions';
import './chat.css';

const DOCK_KEY = 'td.chatDock';

/**
 * The chat button, centred near the bottom. It opens four ready-made questions and a field to ask your own;
 * either opens the field guide chat with the question asked.
 */
export function ChatLauncher({ besidePanel, onMap = false }: { besidePanel: boolean; onMap?: boolean }) {
  const open = useStore((s) => s.chatOpen);
  const set = useStore((s) => s.set);
  const [picker, setPicker] = useState(false);
  const [question, setQuestion] = useState<string | null>(null);
  // Dragged sideways the orb parks in a bottom corner (remembered); a click brings it back to the centre.
  const [docked, setDocked] = useState<'left' | 'right' | null>(() => {
    try {
      const v = window.localStorage.getItem(DOCK_KEY);
      return v === 'left' || v === 'right' ? v : null;
    } catch {
      return null;
    }
  });
  const dock = (side: 'left' | 'right' | null) => {
    setDocked(side);
    try {
      if (side) window.localStorage.setItem(DOCK_KEY, side);
      else window.localStorage.removeItem(DOCK_KEY);
    } catch {
      /* private mode: just not remembered */
    }
  };
  const drag = useRef<{ x: number; dx: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const onOrbDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (open || picker) return;
    drag.current = { x: e.clientX, dx: 0, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onOrbMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    d.dx = e.clientX - d.x;
    if (Math.abs(d.dx) > 6) d.moved = true;
    if (d.moved) root.current?.style.setProperty('--drag-x', `${d.dx}px`);
  };
  const onOrbUp = () => {
    const d = drag.current;
    drag.current = null;
    root.current?.style.removeProperty('--drag-x');
    if (!d?.moved) return;
    dragged.current = true; // swallow the click that follows the drag
    if (Math.abs(d.dx) > 70) dock(d.dx < 0 ? 'left' : 'right');
  };
  // A conversation that is folded away (kept, not thrown out): the orb brings it back.
  const [kept, setKept] = useState(false);
  // "Ask the field guide about this result" and similar links elsewhere open the chat through the store.
  const chatAsk = useStore((s) => s.chatAsk);
  useEffect(() => {
    if (!chatAsk) return;
    setQuestion(chatAsk);
    setPicker(false);
    setKept(false);
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
    setKept(false);
    setQuestion(q);
    setPicker(false);
    set({ chatOpen: true });
  };

  return (
    <div className="chat-dock" data-beside-panel={besidePanel} data-on-map={onMap} data-docked={docked && !open && !picker ? docked : undefined} ref={root}>
      {(open || kept) && (
        <div className="chat-dock__chat" hidden={!open}>
          <ChatDrawer
            key={question ?? 'free'}
            initialQuestion={question}
            onMinimize={() => {
              setKept(true);
              set({ chatOpen: false });
            }}
            onClose={() => {
              setKept(false);
              set({ chatOpen: false });
              setQuestion(null);
            }}
          />
        </div>
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
        {!open && !picker && !docked && <span className="curious-launch__label">{kept ? 'Back to the chat' : 'Curious about Earth?'}</span>}
        <button
          type="button"
          className="orb"
          data-open={picker && !open}
          data-chat={open}
          data-kept={kept && !open}
          aria-expanded={open || picker}
          aria-label={open ? 'Minimize the field guide' : picker ? 'Close questions' : kept ? 'Open the field guide chat' : 'Curious questions about Earth'}
          onPointerDown={onOrbDown}
          onPointerMove={onOrbMove}
          onPointerUp={onOrbUp}
          onPointerCancel={onOrbUp}
          onClick={() => {
            if (dragged.current) {
              dragged.current = false;
              return;
            }
            if (docked) dock(null);
            if (open) {
              setKept(true);
              set({ chatOpen: false });
            } else if (kept) set({ chatOpen: true });
            else setPicker(!picker);
          }}
        >
          <svg className="orb__chat" width="24" height="24" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 11.5c0 4.1-3.6 7.5-8 7.5-1.2 0-2.3-.2-3.3-.6L4 19.5l1.2-3.6C4.4 14.7 4 13.2 4 11.5 4 7.4 7.6 4 12 4s8 3.4 8 7.5z" />
            <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" strokeWidth="2.4" />
          </svg>
          <svg className="orb__min" width="20" height="20" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6.5l4 4 4-4" />
          </svg>
          <svg className="orb__x" width="20" height="20" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  );
}
