import type { AnalysisResult } from '../../api/types';
import { fmt, unitSuffix } from '../../lib/format';
import './detective.css';

/**
 * "Young detective" mode: the result told as a case.
 *
 * - CaseFile: one variable. The clue in plain words and a stamp: CONFIRMED (both tests agree the change is
 *   real) or NOT PROVEN (could be natural wiggles).
 * - CaseBoard: the example's pair. The second variable is either an ALIBI (a natural cause that could explain
 *   the clue, e.g. rainfall next to groundwater or greenness) or a WITNESS (a second clue that should move with
 *   the first, e.g. NO₂ next to night lights). The verdict logic differs for the two roles.
 */

/** Natural causes: if they did not change, they cannot explain the clue. */
const ALIBI_VARIABLES = new Set(['gpm_precipitation']);

type Tone = 'rise' | 'fall' | 'flat';
const toneOf = (r: AnalysisResult): Tone => (r.stats.direction === 'rising' ? 'rise' : r.stats.direction === 'falling' ? 'fall' : 'flat');
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function span(r: AnalysisResult) {
  const pts = r.series.filter((p) => p.value !== null);
  return { from: pts[0]?.date.slice(0, 4) ?? '', to: pts[pts.length - 1]?.date.slice(0, 4) ?? '' };
}

/** Total change along the fitted trend line over the record. */
function totalChange(r: AnalysisResult): number | null {
  const t = r.series.map((p) => p.trend).filter((v): v is number => v !== null);
  return t.length > 1 ? t[t.length - 1] - t[0] : null;
}

function clueSentence(r: AnalysisResult): string {
  const { from, to } = span(r);
  const name = lower(r.variable.name);
  const total = totalChange(r);
  if (r.stats.direction === 'flat' || total === null) return `From ${from} to ${to}, ${name} stayed about the same.`;
  const way = r.stats.direction === 'rising' ? 'went up' : 'went down';
  return `From ${from} to ${to}, ${name} ${way} by about ${fmt(Math.abs(total), 2)}${unitSuffix(r.variable.units)} in total.`;
}

function Stamp({ text, tone }: { text: string; tone: Tone | 'open' }) {
  return (
    <span className="stamp" data-tone={tone} aria-label={`Stamp: ${text}`}>
      {text}
    </span>
  );
}

/** Tiny trend picture: faint data line plus the bold fitted trend. */
export function Sparkline({ result, width = 150, height = 42 }: { result: AnalysisResult; width?: number; height?: number }) {
  const pts = result.series.map((p) => ({ y: p.deseasonalized ?? p.value, t: p.trend }));
  const ys = pts.flatMap((p) => [p.y, p.t]).filter((v): v is number => v !== null && Number.isFinite(v));
  if (ys.length < 2) return null;
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const x = (i: number) => (i / Math.max(1, pts.length - 1)) * (width - 4) + 2;
  const y = (v: number) => height - 3 - ((v - lo) / (hi - lo || 1)) * (height - 6);
  const path = (key: 'y' | 't') =>
    pts
      .map((p, i) => (p[key] === null ? null : `${x(i).toFixed(1)},${y(p[key] as number).toFixed(1)}`))
      .filter(Boolean)
      .join(' ');
  return (
    <svg className="spark" data-tone={toneOf(result)} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline className="spark__data" points={path('y')} />
      <polyline className="spark__trend" points={path('t')} />
    </svg>
  );
}

export function CaseFile({ result }: { result: AnalysisResult }) {
  const sig = result.stats.significant;
  const tone = toneOf(result);
  return (
    <section className="dcase" data-tone={tone} aria-label="Case file">
      <div className="dcase__head">
        <span className="dcase__label">Case file</span>
        <Stamp text={sig ? 'Confirmed' : 'Not proven'} tone={sig ? tone : 'open'} />
      </div>
      <h3 className="dcase__title">The clue: {lower(result.variable.name)}</h3>
      <p className="dcase__clue">{clueSentence(result)}</p>
      <Sparkline result={result} width={300} height={64} />
      <p className="dcase__why">
        {sig
          ? 'Our two detective tests checked whether this could be a fluke, just the normal ups and downs. Both say: very unlikely. The change is real.'
          : 'Our two detective tests could not rule out a fluke: the ups and downs are too big compared with the change. Not proven yet.'}
      </p>
    </section>
  );
}

type Board = { stamp: string; tone: Tone | 'open'; headline: string; story: string };

function judge(main: AnalysisResult, other: AnalysisResult): Board {
  const m = main.stats;
  const o = other.stats;
  const mainName = lower(main.variable.name);
  const otherName = other.variable.name;
  if (!m.significant) {
    return {
      stamp: 'No case',
      tone: 'open',
      headline: `No clear change in ${mainName}.`,
      story: 'There is nothing to explain yet. More years of data may tell a different story.',
    };
  }
  if (ALIBI_VARIABLES.has(other.variable.id)) {
    if (!o.significant) {
      return {
        stamp: 'Case closed',
        tone: toneOf(main),
        headline: `${otherName} has an alibi!`,
        story: `${main.variable.name} changed, but ${lower(otherName)} did not, so the weather did not do it. The prime suspect is people: pumping water, farming, grazing, building.`,
      };
    }
    if (o.direction !== m.direction) {
      return {
        stamp: 'Case closed',
        tone: toneOf(main),
        headline: `${otherName} went the other way.`,
        story: `It cannot be the culprit: it would push ${mainName} in the opposite direction. Something else, most likely people, is behind the change.`,
      };
    }
    return {
      stamp: 'Case open',
      tone: 'open',
      headline: `${otherName} changed too.`,
      story: `Nature is still a suspect: less or more ${lower(otherName)} could explain part of the change in ${mainName}. Look for more clues.`,
    };
  }
  // Witness: a second clue that should move with the first.
  if (o.significant && o.direction === m.direction) {
    return {
      stamp: 'Case closed',
      tone: toneOf(main),
      headline: 'Two clues agree.',
      story: `${main.variable.name} and ${lower(otherName)} both changed in the same direction. The clues back each other up.`,
    };
  }
  if (o.significant) {
    return {
      stamp: 'Case open',
      tone: 'open',
      headline: 'The clues disagree.',
      story: `${otherName} moved the other way. Detectives love a puzzle: what could push them apart?`,
    };
  }
  return {
    stamp: 'Case open',
    tone: 'open',
    headline: `${otherName} did not change.`,
    story: `This clue stands alone for now. The change in ${mainName} is real, but the second witness saw nothing.`,
  };
}

export function CaseBoard({ main, other }: { main: AnalysisResult; other: AnalysisResult }) {
  const alibi = ALIBI_VARIABLES.has(other.variable.id);
  const v = judge(main, other);
  const row = (r: AnalysisResult, role: string) => (
    <div className="board__row">
      <div className="board__who">
        <span className="board__role">{role}</span>
        <span className="board__name">{r.variable.name}</span>
        <span className="board__move" data-tone={toneOf(r)}>
          {r.stats.significant ? (r.stats.direction === 'rising' ? '▲ went up' : r.stats.direction === 'falling' ? '▼ went down' : '■ steady') : '≈ no clear change'}
        </span>
      </div>
      <Sparkline result={r} />
    </div>
  );
  return (
    <section className="board" aria-label="Detective board">
      <div className="dcase__head">
        <span className="dcase__label">Detective board</span>
        <Stamp text={v.stamp} tone={v.tone} />
      </div>
      {row(main, 'The clue')}
      {row(other, alibi ? 'The alibi' : 'The witness')}
      <p className="board__headline">{v.headline}</p>
      <p className="dcase__why">{v.story}</p>
    </section>
  );
}
