import { useEffect, useState } from 'react';

/** Crossfade duration between globe and map (keep in sync with --fade-ms in theme.css). */
export const FADE_MS = 700;

const query = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.(query).matches === true;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export function fadeMs(): number {
  return prefersReducedMotion() ? 0 : FADE_MS;
}
