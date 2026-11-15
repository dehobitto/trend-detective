import { useEffect, useId, useRef, useState } from 'react';
import { pressable } from '../../components/pressable';
import { api } from '../../api/client';
import type { BBox, ExampleCase, Place } from '../../api/types';
import { mapConfig } from '../../config/map';
import { useStore } from '../../state/store';
import { EXAMPLE_PHENOMENON_MAP, PHENOMENA, groupExamplesByPhenomenon, type PhenomenonExample } from '../investigate/phenomena';
import { useLayers } from '../layers/layerStore';
import './search.css';

const cfg = mapConfig.search;

/** The place's area, at least `minAreaDegrees` on each side (cities can be tiny), clamped to the globe. */
export function areaFor(p: Place): BBox {
  const b = p.bbox ?? { west: p.lon, east: p.lon, south: p.lat, north: p.lat };
  const half = cfg.minAreaDegrees / 2;
  const cx = (b.west + b.east) / 2;
  const cy = (b.south + b.north) / 2;
  const w = Math.max(b.east - b.west, cfg.minAreaDegrees);
  const h = Math.max(b.north - b.south, cfg.minAreaDegrees);
  const r = (x: number) => Math.round(x * 100) / 100;
  const south = Math.max(-90, Math.min(cy - h / 2, 90 - 2 * half));
  const west = Math.max(-180, Math.min(cx - w / 2, 180 - 2 * half));
  return { west: r(west), south: r(south), east: r(Math.min(180, west + w)), north: r(Math.min(90, south + h)) };
}

/** Places with a real boundary (OSM relations: countries, states, districts, cities). */
const hasBoundary = (p: Place) => !!p.osm && p.osm.startsWith('R');

async function adoptRegion(p: Place, placeholder: BBox) {
  try {
    const region = await api.getRegionShape(p.osm as string);
    const s = useStore.getState();
    const b = s.bbox;
    if (b && b.west === placeholder.west && b.south === placeholder.south && b.east === placeholder.east && b.north === placeholder.north) {
      s.applyRegion(region);
      if (s.view === 'map') useLayers.getState().flyMap({ center: { lat: p.lat, lon: p.lon }, bounds: region.bbox });
    }
  } catch (e) {
    useStore.getState().set({ mapNotice: `${e instanceof Error ? e.message : 'No boundary for this place'}. Using its rectangle instead.` });
  }
}

export function goToPlace(p: Place, useArea: boolean) {
  const s = useStore.getState();
  const bounds = useArea ? areaFor(p) : p.bbox;
  if (useArea) {
    s.setBBox(bounds);
    if (hasBoundary(p) && bounds) void adoptRegion(p, bounds);
  }
  const center = { lat: p.lat, lon: p.lon };
  if (s.view === 'globe') s.flyTo(center, false, { bounds, zoom: cfg.pointZoom, via: 'search' });
  else useLayers.getState().flyMap({ center, bounds, zoom: cfg.pointZoom });
}

/** Keywords that show all example cases / investigations. */
const SHOW_ALL_KEYWORDS = ['example', 'examples', 'investigation', 'investigations', 'case', 'cases', 'demo'];

/** Match examples whose title or question mentions every word of the query. */
function matchExamples(examples: ExampleCase[], q: string): ExampleCase[] {
  const lower = q.toLowerCase().trim();
  // Show all examples for magic keywords.
  if (SHOW_ALL_KEYWORDS.includes(lower)) return examples;
  const words = lower.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  if (!words.length) return [];
  return examples
    .filter((ex) => {
      const hay = `${ex.title} ${ex.question}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .slice(0, 5);
}

/** Fetch OSM boundary for an investigation example and apply it to the store. */
async function adoptInvestigationRegion(osm: string, placeholderBbox: BBox | null) {
  try {
    const region = await api.getRegionShape(osm);
    const s = useStore.getState();
    // Only apply if the bbox hasn't changed since we started fetching.
    const b = s.bbox;
    if (placeholderBbox && b && b.west === placeholderBbox.west && b.south === placeholderBbox.south && b.east === placeholderBbox.east && b.north === placeholderBbox.north) {
      s.applyRegion(region);
    }
  } catch (e) {
    useStore.getState().set({ mapNotice: `${e instanceof Error ? e.message : 'No boundary available'}. Using rectangle instead.` });
  }
}

/** Open an example: if it maps to a phenomenon, switch to phenomenon mode; otherwise single variable. */
function openExample(ex: ExampleCase) {
  const entry = EXAMPLE_PHENOMENON_MAP[ex.id];
  const ph = entry ? PHENOMENA.find((p) => p.id === entry.phenomenonId) : null;
  const s = useStore.getState();
  if (ph) {
    s.applyPhenomenonExample(ph, ex.bbox, ex.center, ex.start, ex.end, ex.deseasonalize);
    if (entry.osm) void adoptInvestigationRegion(entry.osm, ex.bbox);
  } else {
    s.applyExample(ex);
  }
  if (s.view === 'map' && !s.flat) useLayers.getState().flyMap({ center: ex.center, bounds: ex.bbox ?? undefined, zoom: cfg.pointZoom });
}

/** Place search (city, region, landmark) via GET /api/geocode, with matching example cases on top. */
export function PlaceSearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'empty'>('idle');
  const [error, setError] = useState('');
  const view = useStore((s) => s.view);
  const examples = useStore((s) => s.examples);

  // Group matched examples by phenomenon (dedup same-region entries).
  const rawMatches = q.trim().length >= 2 ? matchExamples(examples, q) : [];
  const phenGroups = groupExamplesByPhenomenon(rawMatches);
  // Also keep ungrouped examples (those without a phenomenon mapping).
  const ungroupedExamples = rawMatches.filter((ex) => !EXAMPLE_PHENOMENON_MAP[ex.id]);
  const exCount = phenGroups.length + ungroupedExamples.length;

  const total = exCount + results.length;
  const busy = useStore((s) => s.transition !== 'idle');
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);

  // Debounced lookup; stale requests are aborted.
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setResults([]);
      setStatus('idle');
      return;
    }
    // Don't geocode magic keywords.
    if (SHOW_ALL_KEYWORDS.includes(text.toLowerCase())) {
      setResults([]);
      setStatus('idle');
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setStatus('loading');
      try {
        const r = await api.geocode(text, cfg.limit, ctrl.signal);
        setResults(r);
        setActive(0);
        setStatus(r.length ? 'idle' : 'empty');
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setResults([]);
        setStatus('error');
        setError(e instanceof Error ? e.message : 'Search failed.');
      }
    }, cfg.debounceMs);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [q]);

  // Close when clicking elsewhere.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);

  const choosePhenExample = (pg: PhenomenonExample) => {
    const ex = pg.example as ExampleCase;
    openExample({ ...ex, id: pg.example.id });
    setQ('');
    setOpen(false);
    input.current?.blur();
  };

  const chooseExample = (ex: ExampleCase) => {
    openExample(ex);
    setQ('');
    setOpen(false);
    input.current?.blur();
  };

  const choose = (p: Place, useArea = false) => {
    goToPlace(p, useArea);
    setQ(p.name);
    setOpen(false);
    input.current?.blur();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (total ? (a + 1) % total : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (total ? (a - 1 + total) % total : 0));
    } else if (e.key === 'Enter') {
      // Grouped phenomenon examples first, then ungrouped, then places.
      if (active < phenGroups.length) {
        e.preventDefault();
        choosePhenExample(phenGroups[active]);
        return;
      }
      const ugIdx = active - phenGroups.length;
      if (ugIdx < ungroupedExamples.length) {
        e.preventDefault();
        chooseExample(ungroupedExamples[ugIdx]);
        return;
      }
      const p = results[active - exCount];
      if (p) {
        e.preventDefault();
        choose(p, e.shiftKey);
      }
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      if (open && q) setOpen(false);
      else {
        setQ('');
        input.current?.blur();
      }
    }
  };

  const showList = open && q.trim().length >= 2 && (total > 0 || status !== 'idle');

  return (
    <div className="place-search" data-view={view} ref={root}>
      <div className="place-search__box" {...pressable}>
        <svg className="place-search__icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5L14 14" />
        </svg>
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active < total ? `${listId}-${active}` : undefined}
          aria-label="Search for a place"
          placeholder='Search places or type "examples"'
          value={q}
          disabled={busy}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          autoComplete="off"
          spellCheck={false}
        />
        {q && (
          <button type="button" className="place-search__clear" aria-label="Clear search" onClick={() => { setQ(''); input.current?.focus(); }}>
            <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        )}
      </div>
      {showList && (
        <ul className="place-search__list" id={listId} role="listbox" aria-label="Places">
          {/* Phenomenon-grouped examples */}
          {phenGroups.map((pg, i) => (
            <li
              key={`ph-${pg.phenomenonId}-${pg.example.id}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="place-search__item place-search__item--case"
              onMouseEnter={() => setActive(i)}
            >
              <button type="button" className="place-search__go" onClick={() => choosePhenExample(pg)}>
                <span className="place-search__kicker">Investigation</span>
                <span className="place-search__name">{pg.phenomenon.name} — {pg.region}</span>
                <span className="place-search__where">{pg.phenomenon.tagline}</span>
                <span className="place-search__vars">{pg.phenomenon.variables.length} variables</span>
              </button>
            </li>
          ))}
          {/* Ungrouped examples (no phenomenon mapping) */}
          {ungroupedExamples.map((ex, i) => (
            <li
              key={ex.id}
              id={`${listId}-${phenGroups.length + i}`}
              role="option"
              aria-selected={phenGroups.length + i === active}
              className="place-search__item place-search__item--case"
              onMouseEnter={() => setActive(phenGroups.length + i)}
            >
              <button type="button" className="place-search__go" onClick={() => chooseExample(ex)}>
                <span className="place-search__kicker">Example case</span>
                <span className="place-search__name">{ex.title}</span>
                <span className="place-search__where">{ex.question}</span>
              </button>
            </li>
          ))}
          {status === 'loading' && total === 0 && <li className="place-search__msg">Searching…</li>}
          {status === 'empty' && !exCount && <li className="place-search__msg">No places found.</li>}
          {status === 'error' && <li className="place-search__msg place-search__msg--err">{error}</li>}
          {results.map((p, i) => (
            <li
              key={`${p.display_name}-${i}`}
              id={`${listId}-${i + exCount}`}
              role="option"
              aria-selected={i + exCount === active}
              className="place-search__item"
              onMouseEnter={() => setActive(i + exCount)}
            >
              <button type="button" className="place-search__go" onClick={() => choose(p)}>
                <span className="place-search__name">{p.name}</span>
                <span className="place-search__where">{p.display_name}</span>
              </button>
              <button type="button" className="place-search__area" onClick={() => choose(p, true)} title="Select this place as the area to investigate (Shift+Enter)">
                Use this area
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
