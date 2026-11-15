import { useEffect, useId, useRef, useState } from 'react';
import { pressable } from '../../components/pressable';
import { api } from '../../api/client';
import type { BBox, Place } from '../../api/types';
import { mapConfig } from '../../config/map';
import { useStore } from '../../state/store';
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

/**
 * "Use this area" on a place with a boundary: fetch it, approximated by squares, and make it the area
 * (outline on the map, the average covers only the squares). Until it arrives the place's rectangle stands in.
 */
async function adoptRegion(p: Place, placeholder: BBox) {
  try {
    const region = await api.getRegionShape(p.osm as string);
    const s = useStore.getState();
    const b = s.bbox;
    // Only if the user has not drawn something else meanwhile.
    if (b && b.west === placeholder.west && b.south === placeholder.south && b.east === placeholder.east && b.north === placeholder.north) {
      s.applyRegion(region);
      if (s.view === 'map') useLayers.getState().flyMap({ center: { lat: p.lat, lon: p.lon }, bounds: region.bbox });
    }
  } catch (e) {
    useStore.getState().set({ mapNotice: `${e instanceof Error ? e.message : 'No boundary for this place'}. Using its rectangle instead.` });
  }
}

/** Go to a place: from the globe this runs the fly-in hand-off; on the map it flies there. */
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

/** Place search (city, region, landmark) via GET /api/geocode. */
export function PlaceSearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'empty'>('idle');
  const [error, setError] = useState('');
  const view = useStore((s) => s.view);
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
      setActive((a) => (results.length ? (a + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      const p = results[active];
      if (p) {
        e.preventDefault();
        choose(p, e.shiftKey);
      }
    } else if (e.key === 'Escape') {
      e.stopPropagation(); // don't also cancel box drawing
      if (open && q) setOpen(false);
      else {
        setQ('');
        input.current?.blur();
      }
    }
  };

  const showList = open && q.trim().length >= 2 && (results.length > 0 || status !== 'idle');

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
          aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
          aria-label="Search for a place"
          placeholder="Search places"
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
          {status === 'loading' && results.length === 0 && <li className="place-search__msg">Searching…</li>}
          {status === 'empty' && <li className="place-search__msg">No places found.</li>}
          {status === 'error' && <li className="place-search__msg place-search__msg--err">{error}</li>}
          {results.map((p, i) => (
            <li
              key={`${p.display_name}-${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="place-search__item"
              onMouseEnter={() => setActive(i)}
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
