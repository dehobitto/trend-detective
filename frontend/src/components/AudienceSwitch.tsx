import { useStore } from '../state/store';
import './components.css';

/** "Young detective" (story first) vs "Scientist" (all the statistics). Remembered on this device. */
export function AudienceSwitch({ className = '' }: { className?: string }) {
  const audience = useStore((s) => s.audience);
  const setAudience = useStore((s) => s.setAudience);
  return (
    <div className={`audience ${className}`} role="radiogroup" aria-label="Who is investigating">
      <button type="button" role="radio" aria-checked={audience === 'kid'} className="audience__opt" onClick={() => setAudience('kid')} title="Story mode: clues, suspects and plain words">
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="6.8" cy="6.8" r="4.3" />
          <path d="M10 10l4 4" />
        </svg>
        Young detective
      </button>
      <button type="button" role="radio" aria-checked={audience === 'scientist'} className="audience__opt" onClick={() => setAudience('scientist')} title="Every statistic: slopes, p-values, both tests">
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 2h4M7 2v4.5L3 13.2A.9.9 0 003.8 14.5h8.4a.9.9 0 00.8-1.3L9 6.5V2" />
          <path d="M4.6 10.5h6.8" />
        </svg>
        Scientist
      </button>
    </div>
  );
}
