import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { useSun } from './sun';

/**
 * A gear in the corner of the globe: display settings that most people never need, out of the way.
 * Real daylight (on by default) and the flat 2D map instead of the globe.
 */
export function GlobeSettings() {
  const [open, setOpen] = useState(false);
  const live = useSun((s) => s.live);
  const setLive = useSun((s) => s.setLive);
  const setFlat = useStore((s) => s.setFlat);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div className="gsettings" ref={root}>
      <button type="button" className="gsettings__gear" aria-expanded={open} aria-label="Display settings" title="Display settings" onClick={() => setOpen(!open)}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3.2" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      </button>
      {open && (
        <div className="gsettings__menu" role="menu" aria-label="Display settings">
          <label className="gsettings__row" role="menuitemcheckbox" aria-checked={live}>
            <span>
              <strong>Real daylight</strong>
              <small>Day and night as they are right now</small>
            </span>
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          </label>
          <button
            type="button"
            className="gsettings__row gsettings__row--btn"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setFlat(true);
            }}
          >
            <span>
              <strong>Flat 2D map</strong>
              <small>Lighter, no globe (remembered on this device)</small>
            </span>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M6 3l5 5-5 5" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
