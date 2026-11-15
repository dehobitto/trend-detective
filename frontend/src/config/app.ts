/** App-wide tunables. Environment overrides come from Vite env vars (see .env.example). */
export const appConfig = {
  /** API base path. The Vite dev server proxies /api -> http://localhost:8000. */
  apiBase: import.meta.env.VITE_API_BASE ?? '/api',
  /** If /api/health doesn't answer within this many ms, the app shows "can't reach the server". */
  healthTimeoutMs: 5000,
  /** Job polling interval (API.md suggests ~400 ms). */
  pollIntervalMs: 400,
  /** Give up only if the job shows no progress for this long. A first download for a new area can take
   *  several minutes, but the backend reports progress all along, so there is no fixed overall limit. */
  pollStallMs: 180_000,
  /** Default analysis settings. */
  defaults: {
    start: '2003-01-01',
    end: '2023-12-31',
    alpha: 0.05,
  },
} as const;
