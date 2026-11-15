import { useEffect, useState } from 'react';
import { useSun } from './sun';

const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/**
 * Globe lighting: "Live sunlight" shows day and night as they are right now (city lights from NASA Black
 * Marble on the dark side); "Spin a day" runs the next 24 hours as a time-lapse. Off = studio light.
 */
export function SunControl() {
  const { live, offsetMs, spinning, setLive, spinDay } = useSun();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(t);
  }, []);
  const shown = now + offsetMs;

  return (
    <div className="sun-ctl" role="group" aria-label="Globe lighting">
      <button
        type="button"
        className="sun-ctl__btn"
        aria-pressed={live}
        onClick={() => setLive(!live)}
        title={live ? 'Real sunlight for this moment. Click for studio light (always daytime).' : 'Show real day and night for this moment'}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="8" cy="8" r="3" fill={live ? 'currentColor' : 'none'} />
          <path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9L13 13M13 3l-1.1 1.1M4.1 11.9L3 13" />
        </svg>
        <span className="sun-ctl__text">
          <span className="sun-ctl__label">{live ? 'Live sunlight' : 'Studio light'}</span>
          {live && <span className="sun-ctl__time">{spinning ? `+${Math.round(offsetMs / 3_600_000)} h · ` : ''}{hhmm(shown)} UTC</span>}
        </span>
      </button>
      <button type="button" className="sun-ctl__btn sun-ctl__btn--spin" onClick={spinDay} disabled={spinning} title="Watch the next 24 hours of day and night">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13.5 8A5.5 5.5 0 113 4.6" />
          <path d="M2.5 1.8v3.3h3.3" />
        </svg>
        <span className="sun-ctl__label">Spin a day</span>
      </button>
    </div>
  );
}
