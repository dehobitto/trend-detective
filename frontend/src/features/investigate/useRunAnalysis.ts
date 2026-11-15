import { useCallback, useEffect, useRef } from 'react';
import { api } from '../../api/client';
import type { AnalysisRequest, Job } from '../../api/types';
import { appConfig } from '../../config/app';
import { needsNoArea, useStore } from '../../state/store';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST an analysis and poll it until done/error. Calls onUpdate with every job snapshot.
 * Returns the final job, or null if cancelled. Throws on network/validation errors.
 */
export async function pollAnalysis(req: AnalysisRequest, onUpdate: (job: Job) => void, cancelled: () => boolean): Promise<Job | null> {
  let job = await api.createAnalysis(req);
  let lastChange = Date.now();
  let lastMark = '';
  while (!cancelled()) {
    onUpdate(job);
    if (job.status === 'done' || job.status === 'error') return job;
    const mark = `${job.status}|${job.progress}|${job.message ?? ''}`;
    if (mark !== lastMark) {
      lastMark = mark;
      lastChange = Date.now();
    } else if (Date.now() - lastChange > appConfig.pollStallMs) {
      throw new Error("NASA's data server stopped responding. Wait a minute and run it again: what was already downloaded is kept.");
    }
    await sleep(appConfig.pollIntervalMs);
    job = await api.getAnalysis(job.id);
  }
  return null;
}

/** Build the request from the store, POST it, then poll the job until done/error. */
export function useRunAnalysis() {
  const runId = useRef(0);
  useEffect(() => () => void (runId.current += 1), []);

  const run = useCallback(async () => {
    const s = useStore.getState();
    if (!s.variableId) return;
    const noArea = needsNoArea(s);
    if (!noArea && !s.bbox) return;
    const req: AnalysisRequest = {
      bbox: noArea ? null : s.bbox, // global records and uploads carry no area
      variable_id: s.variableId,
      start: s.start,
      end: s.end,
      aggregation: s.aggregation,
      deseasonalize: s.aggregation === 'monthly' ? s.deseasonalize : false,
      alpha: s.alpha,
    };
    const id = ++runId.current;
    s.set({ runError: null });
    try {
      const job = await pollAnalysis(req, (j) => useStore.getState().set({ job: j }), () => id !== runId.current);
      if (job?.status === 'error') {
        useStore.getState().set({ runError: job.message ?? 'The analysis failed. Try a different area or date range.' });
      }
    } catch (e) {
      if (id === runId.current) {
        useStore.getState().set({ job: null, runError: e instanceof Error ? e.message : 'The analysis failed.' });
      }
    }
  }, []);

  return run;
}
