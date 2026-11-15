import { globeConfig } from '../../config/globe';

/** What a wheel event means on the globe. */
export type WheelIntent = 'rotate' | 'zoom';

const cfg = globeConfig.gestures;

/**
 * Tells a two-finger trackpad swipe (→ rotate the globe) from a trackpad pinch and a classic mouse wheel
 * (→ zoom). Browsers report all three as `wheel` events:
 * - trackpad pinch: `ctrlKey` is set (Chrome, Firefox, Safari all synthesize it) → zoom;
 * - mouse wheel: line/page `deltaMode`, or pixel steps that are large, whole and purely vertical → zoom;
 * - trackpad swipe: anything else (horizontal component, fractional or small continuous deltas) → rotate.
 * One gesture keeps its first classification (events closer together than `gestureGapMs`), so a swipe
 * that happens to emit one big step doesn't suddenly zoom.
 */
export function createWheelClassifier() {
  let lastAt = -Infinity;
  let current: 'trackpad' | 'mouse' | null = null;

  return (e: WheelEvent): WheelIntent => {
    const now = e.timeStamp || performance.now();
    const fresh = now - lastAt > cfg.gestureGapMs;
    lastAt = now;
    if (e.ctrlKey) return 'zoom'; // pinch
    if (fresh || current === null) {
      const lineMode = e.deltaMode !== 0;
      const mouseLike = Math.abs(e.deltaX) < 0.5 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= cfg.mouseMinStep;
      current = lineMode || mouseLike ? 'mouse' : 'trackpad';
    }
    return current === 'trackpad' ? 'rotate' : 'zoom';
  };
}
