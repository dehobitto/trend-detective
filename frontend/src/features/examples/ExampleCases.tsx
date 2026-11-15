import { forwardRef, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ExampleCase } from '../../api/types';
import { api } from '../../api/client';
import { resolveGuideThemes, type ResolvedTheme } from '../../config/guide';
import { EXAMPLE_PHENOMENON_MAP, PHENOMENA } from '../investigate/phenomena';
import { useStore } from '../../state/store';
import './examples.css';

type Mode = { step: 'cases' } | { step: 'what' } | { step: 'where'; theme: ResolvedTheme };

/**
 * The "case file" prompt on the globe screen. Picking a case flies the globe there and opens the map
 * with the area and variable already chosen. "Help me choose" swaps the card's contents for a short
 * two-question guide (what, then where) that ends in the same places.
 */
/** Apply an example — route through phenomenon mode if it maps to one. */
function smartApply(ex: ExampleCase) {
  const s = useStore.getState();
  const entry = EXAMPLE_PHENOMENON_MAP[ex.id];
  const ph = entry ? PHENOMENA.find((p) => p.id === entry.phenomenonId) : null;
  if (ph) {
    s.applyPhenomenonExample(ph, ex.bbox, ex.center, ex.start, ex.end, ex.deseasonalize);
    if (entry.osm) void adoptInvestigationRegion(entry.osm, ex.bbox);
  } else {
    s.applyExample(ex);
  }
}

/** Fetch OSM boundary for an investigation example and apply it to the store. */
async function adoptInvestigationRegion(osm: string, placeholderBbox: import('../../api/types').BBox | null) {
  try {
    const region = await api.getRegionShape(osm);
    const s = useStore.getState();
    const b = s.bbox;
    if (placeholderBbox && b && b.west === placeholderBbox.west && b.south === placeholderBbox.south && b.east === placeholderBbox.east && b.north === placeholderBbox.north) {
      s.applyRegion(region);
    }
  } catch {
    useStore.getState().set({ mapNotice: 'No boundary available. Using rectangle instead.' });
  }
}

export function ExampleCases() {
  const examples = useStore((s) => s.examples);
  const variables = useStore((s) => s.variables);
  const flat = useStore((s) => s.flat);
  const transition = useStore((s) => s.transition);
  const [focused, setFocused] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ step: 'cases' });
  const busy = transition !== 'idle';

  const themes = useMemo(() => resolveGuideThemes(variables, examples), [variables, examples]);
  const listRef = useRef<HTMLDivElement>(null);
  const guideBtn = useRef<HTMLButtonElement>(null);
  // What was selected before the guide opened, so leaving it without choosing changes nothing.
  const before = useRef<{ variableId: string | null; start: string; end: string } | null>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    setFocused(null);
    if (mode.step !== 'cases') listRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    else if (returnFocus.current) guideBtn.current?.focus();
    returnFocus.current = false;
  }, [mode]);

  const openGuide = () => {
    const s = useStore.getState();
    before.current = { variableId: s.variableId, start: s.start, end: s.end };
    setMode({ step: 'what' });
  };

  const closeGuide = () => {
    if (before.current) useStore.getState().set({ ...before.current, job: null, runError: null });
    returnFocus.current = true;
    setMode({ step: 'cases' });
  };

  const back = () => (mode.step === 'where' ? setMode({ step: 'what' }) : closeGuide());

  const chooseTheme = (t: ResolvedTheme) => {
    const s = useStore.getState();
    const primary = t.variables[0];
    s.selectVariable(primary.id);
    if (primary.location) s.peekAt(primary.location);
    setMode({ step: 'where', theme: t });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && mode.step !== 'cases') {
      e.preventDefault();
      back();
    }
  };

  if (mode.step === 'cases') {
    const ex = examples.find((x) => x.id === focused);
    return (
      <section className="cases" aria-labelledby="cases-title">
        <h2 id="cases-title" className="cases__title">
          Pick a place to investigate
        </h2>
        <p className="cases__lede" aria-live="polite">
          {focused === 'guide' ? 'Two quick questions, then we take you there.' : ex ? ex.question : flat ? 'Draw an area on the map or search for a place. Or start from a case below.' : 'Click anywhere on Earth or scroll in to open the map. Or start from a case below.'}
        </p>
        <div className="cases__list" onMouseLeave={() => setFocused(null)}>
          {examples.map((x) => (
            <CaseButton key={x.id} id={x.id} label={x.title} meta={coords(x.center)} disabled={busy} onFocusChange={setFocused} onClick={() => smartApply(x)} />
          ))}
        </div>
        {themes.length > 0 && (
          <div className="cases__foot">
            <span className="cases__foot-note">Not sure where to start?</span>
            <button
              ref={guideBtn}
              type="button"
              className="cases__guide"
              disabled={busy}
              onPointerEnter={(e) => e.pointerType === 'mouse' && setFocused('guide')}
              onPointerLeave={() => setFocused(null)}
              onFocus={() => setFocused('guide')}
              onBlur={() => setFocused(null)}
              onClick={openGuide}
            >
              Help me choose
            </button>
          </div>
        )}
      </section>
    );
  }

  const isWhat = mode.step === 'what';
  const title = isWhat ? 'What do you want to investigate?' : 'Where?';
  const options = isWhat ? themeOptions(themes, chooseTheme) : whereOptions(mode.theme, smartApply);
  const current = options.find((o) => o.id === focused);
  const primary = !isWhat ? mode.theme.variables[0] : null;
  const defaultLede = isWhat
    ? 'Choose a topic. You can change anything later.'
    : primary?.coverage === 'series'
      ? `${mode.theme.label}: these are single long records, so there is no area to draw.`
      : `We'll start with ${primary?.name.toLowerCase()}. You can switch in the panel.`;

  return (
    <section className="cases cases--guide" aria-labelledby="cases-title" onKeyDown={onKeyDown}>
      <div className="cases__head">
        <button type="button" className="cases__back" onClick={back} disabled={busy}>
          Back
        </button>
        <h2 id="cases-title" className="cases__title">
          {title}
        </h2>
        <span className="cases__step">Step {isWhat ? '1' : '2'} of 2</span>
      </div>
      <p className="cases__lede" aria-live="polite">
        {current?.hint ?? defaultLede}
      </p>
      <div className="cases__list" role="group" aria-labelledby="cases-title" ref={listRef} onMouseLeave={() => setFocused(null)}>
        {options.map((o) => (
          <CaseButton key={o.id} id={o.id} label={o.label} variant={o.variant} disabled={busy} onFocusChange={setFocused} onClick={o.onClick} />
        ))}
      </div>
    </section>
  );
}

type Option = { id: string; label: string; hint: string; variant?: 'plain' | 'guide'; onClick: () => void };

function themeOptions(themes: ResolvedTheme[], choose: (t: ResolvedTheme) => void): Option[] {
  return themes.map((t) => ({ id: t.id, label: t.label, hint: t.hint, onClick: () => choose(t) }));
}

/** Example cases for the theme, plus the open-ended way in: the map, or a global record. */
function whereOptions(theme: ResolvedTheme, applyExample: (ex: ExampleCase) => void): Option[] {
  const opts: Option[] = theme.examples.map((ex) => ({ id: ex.id, label: ex.title, hint: ex.question, onClick: () => applyExample(ex) }));
  const fallbackFocus = theme.focus ?? theme.examples[0]?.center ?? { lat: 20, lon: 0 };

  const mapVar = theme.variables.find((v) => v.coverage !== 'series');
  if (mapVar) {
    opts.push({
      id: 'map',
      label: "I'll pick a place on the map",
      hint: `Opens the map with ${mapVar.name.toLowerCase()} chosen. Then draw a rectangle around your place.`,
      variant: 'guide',
      onClick: () => {
        const s = useStore.getState();
        s.selectVariable(mapVar.id);
        s.set({ bbox: null, activeExample: null, panelRequested: true });
        s.flyTo(fallbackFocus);
      },
    });
  }

  // Records with no case file of their own still get a way in.
  const covered = new Set(theme.examples.map((ex) => ex.variable_id));
  const records = theme.variables.filter((v) => v.coverage === 'series' && !covered.has(v.id));
  for (const v of records) {
    opts.push({
      id: `record:${v.id}`,
      label: records.length === 1 ? 'Show the global record' : v.name,
      hint: `${v.name}, ${v.available_start.slice(0, 4)} to ${v.available_end.slice(0, 4)}. ${v.why_it_matters}`,
      variant: 'guide',
      onClick: () => {
        const s = useStore.getState();
        s.selectVariable(v.id);
        s.set({ bbox: null, activeExample: null, pendingRun: true });
        s.flyTo(v.location ?? fallbackFocus);
      },
    });
  }
  return opts;
}

/** Compact atlas-style coordinates for a case's centre, e.g. "31°N 76°E". */
function coords(c: { lat: number; lon: number }): string {
  const lat = `${Math.round(Math.abs(c.lat))}°${c.lat >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.round(Math.abs(c.lon))}°${c.lon >= 0 ? 'E' : 'W'}`;
  return `${lat} ${lon}`;
}

type CaseButtonProps = {
  id: string;
  label: string;
  meta?: string;
  variant?: 'plain' | 'guide';
  disabled: boolean;
  onFocusChange: (id: string | null) => void;
  onClick: () => void;
};

const CaseButton = forwardRef<HTMLButtonElement, CaseButtonProps>(function CaseButton(
  { id, label, meta, variant = 'plain', disabled, onFocusChange, onClick },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`case${variant === 'guide' ? ' case--guide' : ''}`}
      disabled={disabled}
      // Mouse only: a tap leaves a sticky hover on whatever row appears under the finger next.
      onPointerEnter={(e) => e.pointerType === 'mouse' && onFocusChange(id)}
      onFocus={() => onFocusChange(id)}
      onBlur={() => onFocusChange(null)}
      onClick={onClick}
    >
      <span className="case__label">{label}</span>
      {meta && <span className="case__meta">{meta}</span>}
    </button>
  );
});
