import { Segmented } from '../../components/Segmented';
import { Toggle } from '../../components/Toggle';
import { useStore } from '../../state/store';
import type { Aggregation } from '../../api/types';

export function AnalysisOptions() {
  const aggregation = useStore((s) => s.aggregation);
  const deseasonalize = useStore((s) => s.deseasonalize);
  const set = useStore((s) => s.set);
  const annual = aggregation === 'annual';

  return (
    <div className="options">
      <div className="options__row">
        <span className="options__label">Time step</span>
        <Segmented<Aggregation>
          label="Time step"
          value={aggregation}
          onChange={(v) => set({ aggregation: v, job: null })}
          options={[
            { value: 'monthly', label: 'Monthly' },
            { value: 'annual', label: 'Annual' },
          ]}
        />
      </div>
      <div className="options__row options__row--stack">
        <Toggle label="Remove the seasonal cycle" checked={!annual && deseasonalize} disabled={annual} onChange={(v) => set({ deseasonalize: v, job: null })} />
        <p className="notes notes--small">
          {annual
            ? 'Annual averages already smooth out the seasons.'
            : 'Every summer is warmer than every winter. Subtracting the usual value for each month leaves only the change over the years.'}
        </p>
      </div>
    </div>
  );
}
