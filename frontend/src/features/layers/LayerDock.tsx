import { useEffect, useMemo } from 'react';
import { mapConfig } from '../../config/map';
import { useSelectedVariable, useStore } from '../../state/store';
import { cssGradient, formatFrame, nearestFrame } from './frames';
import { useLayers } from './layerStore';
import './layers.css';

const cfg = mapConfig.variableLayer;

const Svg = ({ d, fill }: { d: string; fill?: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const IconPlay = () => <Svg d="M5 3.5v9l7-4.5z" fill />;
const IconPause = () => <Svg d="M5 3.5v9M11 3.5v9" />;
const IconPrev = () => <Svg d="M4 3.5v9M12 3.5L6 8l6 4.5z" />;
const IconNext = () => <Svg d="M12 3.5v9M4 3.5L10 8l-6 4.5z" />;
const IconEye = ({ off }: { off: boolean }) =>
  off ? <Svg d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4zM3 13L13 3" /> : <Svg d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4zM8 6.2a1.8 1.8 0 100 3.6 1.8 1.8 0 000-3.6z" />;

function fmtNum(x: number): string {
  const a = Math.abs(x);
  if (a >= 1000) return x.toFixed(0);
  if (a >= 10) return x.toFixed(0);
  if (a >= 1) return x.toFixed(1);
  return x.toPrecision(2);
}

/** Year ticks for the scrubber, thinned so labels never collide. */
function yearTicks(frames: string[]) {
  const ticks: { year: number; pos: number }[] = [];
  let last = '';
  frames.forEach((d, i) => {
    const y = d.slice(0, 4);
    if (y !== last) {
      ticks.push({ year: Number(y), pos: frames.length > 1 ? i / (frames.length - 1) : 0 });
      last = y;
    }
  });
  const every = [1, 2, 5, 10, 20].find((k) => ticks.length / k <= 8) ?? 25;
  return ticks.map((t) => ({ ...t, label: t.year % every === 0 || ticks.length <= 8 }));
}

/**
 * Docked bottom bar for the variable map layer: show/hide, opacity, legend, and a timeline
 * (play/pause, step, scrubber with year ticks, speed) like a weather-radar app.
 */
export function LayerDock({ besidePanel }: { besidePanel: boolean }) {
  const variable = useSelectedVariable();
  const { layer, frames, date, playing, speedIdx, loading, frameMissing, overlayOn, opacity, gridLegend, overlayError, set } = useLayers();
  const job = useStore((s) => s.job);

  const idx = useMemo(() => (date ? frames.indexOf(date) : -1), [frames, date]);
  const ticks = useMemo(() => yearTicks(frames), [frames]);

  // Playback: advance after the frame interval, but wait (up to a limit) for the current frame to load.
  useEffect(() => {
    if (!playing || frames.length < 2) return;
    let waited = 0;
    let t = 0;
    const tick = () => {
      const s = useLayers.getState();
      if (s.loading && waited < cfg.maxFrameWaitMs) {
        waited += 100;
        t = window.setTimeout(tick, 100);
        return;
      }
      const i = s.frames.indexOf(s.date ?? '');
      s.set({ date: s.frames[(i + 1) % s.frames.length] });
    };
    t = window.setTimeout(tick, cfg.speeds[speedIdx].ms);
    return () => window.clearTimeout(t);
  }, [playing, date, speedIdx, frames]);

  if (!layer || !variable || frames.length === 0) return null;

  const step = (d: number) => {
    if (idx < 0) return;
    set({ playing: false, date: frames[Math.max(0, Math.min(frames.length - 1, idx + d))] });
  };
  const stepKind = layer.kind === 'gibs' && !(layer.time_step === 'daily' && cfg.dailyFrameStep === 'monthly') ? layer.time_step : 'monthly';

  // Analysed period, if a result is on screen.
  const req = job?.status === 'done' && job.result && job.request.variable_id === variable.id ? job.request : null;
  const mark = (d: string) => (frames.length > 1 ? nearestFrame(frames, d) / (frames.length - 1) : 0);

  return (
    <section className="layer-dock" data-beside-panel={besidePanel} aria-label="Map layer and timeline">
      <div className="layer-dock__head">
        <button
          type="button"
          className="ld-btn"
          aria-pressed={overlayOn}
          aria-label={overlayOn ? 'Hide map layer' : 'Show map layer'}
          title={overlayOn ? 'Hide map layer' : 'Show map layer'}
          onClick={() => set({ overlayOn: !overlayOn })}
        >
          <IconEye off={!overlayOn} />
        </button>
        <div className="layer-dock__title">
          <span className="layer-dock__name">{variable.name}</span>
          <span className="layer-dock__src">
            {layer.kind === 'gibs' ? 'NASA GIBS imagery' : gridLegend?.synthetic ? 'Gridded values · demo data' : 'Gridded values'}
          </span>
        </div>
        <Legend />
        <label className="layer-dock__opacity" title="Layer opacity">
          <span className="sr-only">Opacity</span>
          <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => set({ opacity: Number(e.target.value), overlayOn: true })} />
        </label>
      </div>

      <div className="layer-dock__time">
        <div className="layer-dock__transport">
          <button type="button" className="ld-btn" aria-label="Previous frame" onClick={() => step(-1)} disabled={idx <= 0}>
            <IconPrev />
          </button>
          <button
            type="button"
            className="ld-btn ld-btn--play"
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={() => {
              if (!playing && idx === frames.length - 1) set({ date: frames[0] }); // replay from the start
              set({ playing: !playing });
            }}
            disabled={frames.length < 2}
          >
            {playing ? <IconPause /> : <IconPlay />}
          </button>
          <button type="button" className="ld-btn" aria-label="Next frame" onClick={() => step(1)} disabled={idx >= frames.length - 1}>
            <IconNext />
          </button>
        </div>

        <output className="layer-dock__date" aria-live={playing ? 'off' : 'polite'} data-loading={loading}>
          {date ? formatFrame(date, stepKind) : '—'}
        </output>

        <div className="layer-dock__track">
          <input
            className="layer-dock__scrub"
            type="range"
            min={0}
            max={Math.max(0, frames.length - 1)}
            step={1}
            value={Math.max(0, idx)}
            aria-label="Date"
            aria-valuetext={date ? formatFrame(date, stepKind) : undefined}
            onChange={(e) => set({ playing: false, date: frames[Number(e.target.value)] })}
          />
          <div className="layer-dock__ticks" aria-hidden>
            {ticks.map((t) => (
              <span key={t.year} className="layer-dock__tick" data-label={t.label} style={{ left: `${t.pos * 100}%` }}>
                {t.label && <span>{t.year}</span>}
              </span>
            ))}
            {req && (
              <span
                className="layer-dock__period"
                title="Period analysed"
                style={{ left: `${mark(req.start) * 100}%`, width: `${Math.max(0.5, (mark(req.end) - mark(req.start)) * 100)}%` }}
              />
            )}
          </div>
        </div>

        <button
          type="button"
          className="ld-btn ld-btn--speed"
          title="Playback speed"
          aria-label={`Playback speed ${cfg.speeds[speedIdx].label}`}
          onClick={() => set({ speedIdx: (speedIdx + 1) % cfg.speeds.length })}
        >
          {cfg.speeds[speedIdx].label}
        </button>
      </div>
      {overlayError && <p className="layer-dock__error">{overlayError}</p>}
      {!overlayError && frameMissing && !loading && (
        <p className="layer-dock__note" role="status">
          No satellite image for this {stepKind === 'daily' ? 'day' : stepKind === 'yearly' ? 'year' : 'month'}.
        </p>
      )}
    </section>
  );
}

function Legend() {
  const layer = useLayers((s) => s.layer);
  const grid = useLayers((s) => s.gridLegend);
  if (layer?.kind === 'gibs') {
    return layer.legend_url ? (
      <span className="layer-dock__legend-imgwrap">
        <img className="layer-dock__legend-img" src={layer.legend_url} alt="Colour legend for this layer" />
      </span>
    ) : (
      <span className="layer-dock__legend-note">Colours as published by NASA GIBS</span>
    );
  }
  if (!grid) return <span className="layer-dock__legend" aria-hidden />;
  return (
    <div className="layer-dock__legend" role="img" aria-label={`Colour scale from ${fmtNum(grid.min)} to ${fmtNum(grid.max)} ${grid.units}`}>
      <span className="layer-dock__ramp" style={{ background: cssGradient(grid.colormap, grid.min, grid.max) }} />
      <span className="layer-dock__scale">
        <span>{fmtNum(grid.min)}</span>
        <span className="layer-dock__units">{grid.units}</span>
        <span>{fmtNum(grid.max)}</span>
      </span>
    </div>
  );
}
