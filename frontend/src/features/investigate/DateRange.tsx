import { UPLOAD_PREFIX } from '../../api/types';
import { useStore } from '../../state/store';

/** Year-level date range, bounded by what the chosen instrument covers. */
export function DateRange() {
  const start = useStore((s) => s.start);
  const end = useStore((s) => s.end);
  const set = useStore((s) => s.set);
  const variableId = useStore((s) => s.variableId);
  const variable = useStore((s) => s.variables.find((v) => v.id === s.variableId));
  const dataset = useStore((s) => s.datasets.find((d) => `${UPLOAD_PREFIX}${d.id}` === s.variableId));

  const minY = Number((variable?.available_start ?? dataset?.start ?? '1980').slice(0, 4));
  const maxY = Number((variable?.available_end ?? dataset?.end ?? String(new Date().getFullYear())).slice(0, 4));
  const years = Array.from({ length: Math.max(1, maxY - minY + 1) }, (_, i) => minY + i);
  const sy = Number(start.slice(0, 4));
  const ey = Number(end.slice(0, 4));

  return (
    <div className="date-range">
      <label>
        <span>From</span>
        <select
          value={sy}
          disabled={!variableId}
          onChange={(e) => {
            const y = Number(e.target.value);
            set({ start: `${y}-01-01`, ...(y >= ey ? { end: `${Math.min(maxY, y + 1)}-12-31` } : {}), job: null });
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
          disabled={!variableId}
          onChange={(e) => {
            const y = Number(e.target.value);
            set({ end: `${y}-12-31`, ...(y <= sy ? { start: `${Math.max(minY, y - 1)}-01-01` } : {}), job: null });
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
