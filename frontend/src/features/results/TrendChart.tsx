import { useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AnalysisResult } from '../../api/types';
import { Segmented } from '../../components/Segmented';
import { colors } from '../../config/colors';
import { fmt, unitSuffix } from '../../lib/format';

type Row = { t: number; date: string; y: number | null; trend: number | null; band: [number, number] | null };
type Mode = 'analyzed' | 'raw';

const toT = (d: string) => Date.parse(`${d}T00:00:00Z`);
const year = (t: number) => String(new Date(t).getUTCFullYear());

function ChartTooltip({ active, payload, units }: { active?: boolean; payload?: { payload: Row }[]; units: string }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="chart-tip">
      <div className="chart-tip__date">{r.date.slice(0, 7)}</div>
      {r.y !== null && (
        <div>
          Value <strong>{fmt(r.y)}</strong>
          {unitSuffix(units)}
        </div>
      )}
      {r.trend !== null && (
        <div className="chart-tip__dim">
          Trend {fmt(r.trend)}
          {unitSuffix(units)}
        </div>
      )}
    </div>
  );
}

/**
 * Time series + fitted trend + CI band.
 * Trend colour encodes direction (rise/fall); line style encodes significance (solid = significant, dashed = not).
 */
export function TrendChart({ result, height = 230 }: { result: AnalysisResult; height?: number }) {
  const deseason = result.analyzed_series === 'deseasonalized';
  const [mode, setMode] = useState<Mode>('analyzed');
  const showTrend = mode === 'analyzed';
  const { stats, variable } = result;
  const trendColor = stats.direction === 'falling' ? colors.fall : stats.direction === 'rising' ? colors.rise : colors.inkDim;

  const rows = useMemo<Row[]>(
    () =>
      result.series.map((p) => ({
        t: toT(p.date),
        date: p.date,
        y: mode === 'raw' || !deseason ? p.value : p.deseasonalized,
        trend: p.trend,
        band: p.ci_low !== null && p.ci_high !== null ? [p.ci_low, p.ci_high] : null,
      })),
    [result, mode, deseason],
  );

  const label = mode === 'raw' || !deseason ? `${variable.name}${unitSuffix(variable.units) ? ` (${variable.units})` : ''}` : `Difference from the usual for that month${unitSuffix(variable.units) ? ` (${variable.units})` : ''}`;

  return (
    <figure className="chart">
      <div className="chart__head">
        <figcaption className="chart__caption">{label}</figcaption>
        {deseason && (
          <Segmented<Mode>
            label="Series shown"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'analyzed', label: 'Anomalies' },
              { value: 'raw', label: 'Raw values' },
            ]}
          />
        )}
      </div>
      <div className="chart__plot">
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={colors.line} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={year}
              stroke={colors.inkDim}
              tick={{ fill: colors.inkDim, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: colors.line }}
              minTickGap={28}
            />
            <YAxis
              width={44}
              stroke={colors.inkDim}
              tick={{ fill: colors.inkDim, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => fmt(v, 2)}
              domain={['auto', 'auto']}
            />
            <Tooltip content={<ChartTooltip units={variable.units} />} cursor={{ stroke: colors.inkDim, strokeDasharray: '3 3' }} />
            {showTrend && <Area dataKey="band" stroke="none" fill={trendColor} fillOpacity={0.16} isAnimationActive={false} activeDot={false} />}
            <Line dataKey="y" stroke={colors.ink} strokeOpacity={0.55} strokeWidth={1.2} dot={false} isAnimationActive={false} connectNulls={false} />
            {showTrend && (
              <Line
                dataKey="trend"
                stroke={trendColor}
                strokeWidth={2.6}
                strokeDasharray={stats.significant ? undefined : '7 6'}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="chart__legend" aria-hidden={false}>
        <span className="legend-item">
          <span className="legend-swatch legend-swatch--data" /> {mode === 'raw' || !deseason ? 'Area average' : 'Anomaly'}
        </span>
        {showTrend && (
          <>
            <span className="legend-item">
              <svg width="22" height="6" aria-hidden>
                <line x1="0" y1="3" x2="22" y2="3" stroke={trendColor} strokeWidth="2.6" strokeDasharray={stats.significant ? undefined : '5 4'} />
              </svg>
              Trend, {stats.significant ? 'significant' : 'not significant'}
            </span>
            <span className="legend-item">
              <span className="legend-swatch" style={{ background: trendColor, opacity: 0.3 }} /> {Math.round((1 - stats.alpha) * 100)}% confidence band
            </span>
          </>
        )}
        {!showTrend && <span className="legend-item hint">The trend was fitted to the anomalies.</span>}
      </div>
    </figure>
  );
}
