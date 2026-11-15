import { UPLOAD_PREFIX } from '../../api/types';
import { useStore } from '../../state/store';
import { PHENOMENA } from './phenomena';

/** Compute the intersection of available year ranges for a list of variable IDs. */
function multiVarRange(ids: string[], variables: { id: string; available_start: string; available_end: string }[]): { minY: number; maxY: number } | null {
  let minY: number | null = null;
  let maxY: number | null = null;
  for (const id of ids) {
    const v = variables.find((x) => x.id === id);
    if (!v) continue;
    const y0 = Number(v.available_start.slice(0, 4));
    const y1 = Number(v.available_end.slice(0, 4));
    minY = minY === null ? y0 : Math.max(minY, y0);
    maxY = maxY === null ? y1 : Math.min(maxY, y1);
  }
  return minY !== null && maxY !== null ? { minY, maxY } : null;
}

/** Year-level date range, bounded by what the chosen instrument covers. */
export function DateRange() {
  const start = useStore((s) => s.start);
  const end = useStore((s) => s.end);
  const set = useStore((s) => s.set);
  const variableId = useStore((s) => s.variableId);
  const selectedIds = useStore((s) => s.selectedVariableIds);
  const pickerMode = useStore((s) => s.pickerMode);
  const phenomenonId = useStore((s) => s.phenomenonId);
  const variables = useStore((s) => s.variables);
  const variable = variables.find((v) => v.id === variableId);
  const dataset = useStore((s) => s.datasets.find((d) => `${UPLOAD_PREFIX}${d.id}` === variableId));

  // Multi-variable: intersection of all selected variables' ranges.
  let multiRange: { minY: number; maxY: number } | null = null;
  if (pickerMode === 'phenomenon' && phenomenonId) {
    const ph = PHENOMENA.find((p) => p.id === phenomenonId);
    if (ph) multiRange = multiVarRange(ph.variables.map((v) => v.variable_id), variables);
  } else if (selectedIds.length > 1) {
    multiRange = multiVarRange(selectedIds, variables);
  }

  const hasChoice = pickerMode === 'phenomenon' ? !!phenomenonId : selectedIds.length > 0;
  const minY = multiRange?.minY ?? Number((variable?.available_start ?? dataset?.start ?? '1980').slice(0, 4));
  const maxY = multiRange?.maxY ?? Number((variable?.available_end ?? dataset?.end ?? String(new Date().getFullYear())).slice(0, 4));
  const years = Array.from({ length: Math.max(1, maxY - minY + 1) }, (_, i) => minY + i);
  const sy = Number(start.slice(0, 4));
  const ey = Number(end.slice(0, 4));

  return (
    <div className="date-range">
      <label>
        <span>From</span>
        <select
          value={sy}
          disabled={!hasChoice}
          onChange={(e) => {
            const y = Number(e.target.value);
            set({ start: `${y}-01-01`, ...(y >= ey ? { end: `${Math.min(maxY, y + 1)}-12-31` } : {}), job: null, phenomenonJobs: {}, phenomenonError: null });
          }}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>to</span>
        <select
          value={ey}
          disabled={!hasChoice}
          onChange={(e) => {
            const y = Number(e.target.value);
            set({ end: `${y}-12-31`, ...(y <= sy ? { start: `${Math.max(minY, y - 1)}-01-01` } : {}), job: null, phenomenonJobs: {}, phenomenonError: null });
          }}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <span className="hint">{Math.max(0, ey - sy + 1)} years</span>
    </div>
  );
}
