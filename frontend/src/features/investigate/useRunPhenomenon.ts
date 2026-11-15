import { useCallback, useEffect, useRef } from 'react';
import type { AnalysisRequest } from '../../api/types';
import { needsNoArea, useStore } from '../../state/store';
import { PHENOMENA } from './phenomena';
import { pollAnalysis } from './useRunAnalysis';

/**
 * Run a list of variable IDs in parallel.
 * Used by both phenomenon mode and multi-variable selection in variable mode.
 * Results are stored in phenomenonJobs keyed by variable_id.
 */
function runVariableList(varIds: string[], runId: { current: number }) {
  return async () => {
    const s = useStore.getState();
    const noArea = needsNoArea(s);
    if (!noArea && !s.bbox) return;
    if (varIds.length === 0) return;

    const id = ++runId.current;
    useStore.getState().set({ phenomenonError: null, phenomenonJobs: {} });

    const requests: { variableId: string; req: AnalysisRequest }[] = varIds.map((vid) => ({
      variableId: vid,
      req: {
        bbox: noArea ? null : s.bbox,
        variable_id: vid,
        start: s.start,
        end: s.end,
        aggregation: s.aggregation,
        deseasonalize: s.aggregation === 'monthly' ? s.deseasonalize : false,
        alpha: s.alpha,
        ...(!noArea && s.region && s.bbox === s.region.bbox ? { cells: s.region.cells, region_name: s.region.name } : {}),
      },
    }));

    const promises = requests.map(async ({ variableId, req }) => {
      try {
        const job = await pollAnalysis(
          req,
          (j) => {
            if (id !== runId.current) return;
            const prev = useStore.getState();
            useStore.getState().set({
              phenomenonJobs: { ...prev.phenomenonJobs, [variableId]: j },
            });
          },
          () => id !== runId.current,
        );
        if (job?.status === 'error' && id === runId.current) {
          const prev = useStore.getState();
          useStore.getState().set({
            phenomenonError: prev.phenomenonError ?? job.message ?? `Analysis for ${variableId} failed.`,
          });
        }
      } catch (e) {
        if (id === runId.current) {
          const prev = useStore.getState();
          useStore.getState().set({
            phenomenonJobs: { ...prev.phenomenonJobs, [variableId]: null },
            phenomenonError: prev.phenomenonError ?? (e instanceof Error ? e.message : `Analysis for ${variableId} failed.`),
          });
        }
      }
    });

    await Promise.allSettled(promises);
  };
}

/** Run all variables in a phenomenon in parallel. */
export function useRunPhenomenon() {
  const runId = useRef(0);
  useEffect(() => () => void (runId.current += 1), []);

  return useCallback(async () => {
    const s = useStore.getState();
    if (!s.phenomenonId) return;
    const ph = PHENOMENA.find((p) => p.id === s.phenomenonId);
    if (!ph) return;
    await runVariableList(ph.variables.map((ve) => ve.variable_id), runId)();
  }, []);
}

/** Run multiple selected variables in parallel (variable mode multi-select). */
export function useRunMultiVariable() {
  const runId = useRef(0);
  useEffect(() => () => void (runId.current += 1), []);

  return useCallback(async () => {
    const s = useStore.getState();
    if (s.selectedVariableIds.length < 2) return;
    await runVariableList(s.selectedVariableIds, runId)();
  }, []);
}
