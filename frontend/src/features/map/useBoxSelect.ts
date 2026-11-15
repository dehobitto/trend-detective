import type { LngLat, Map as MlMap, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';
import { useEffect } from 'react';
import type { BBox } from '../../api/types';
import { mapConfig } from '../../config/map';
import { normalizeBBox } from '../../lib/geo';
import { useStore } from '../../state/store';
import { BBOX_LINE, setBBoxData } from './layers';

type Gesture =
  | { kind: 'draw'; start: LngLat }
  | { kind: 'move'; anchor: LngLat; original: BBox };

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Screen-space distance (px) from the box outline within which a press grabs the box instead of panning. */
const EDGE_GRAB_PX = 10;

/** True when the point is on (near) the rectangle's outline. Inside the box, the map still pans. */
function nearOutline(map: MlMap, b: BBox, p: { x: number; y: number }): boolean {
  const nw = map.project([b.west, b.north]);
  const se = map.project([b.east, b.south]);
  const [x0, x1] = [Math.min(nw.x, se.x), Math.max(nw.x, se.x)];
  const [y0, y1] = [Math.min(nw.y, se.y), Math.max(nw.y, se.y)];
  const e = EDGE_GRAB_PX;
  const withinOuter = p.x >= x0 - e && p.x <= x1 + e && p.y >= y0 - e && p.y <= y1 + e;
  const withinInner = p.x > x0 + e && p.x < x1 - e && p.y > y0 + e && p.y < y1 - e;
  return withinOuter && !withinInner;
}

function shifted(b: BBox, dLng: number, dLat: number): BBox {
  const w = b.east - b.west;
  const h = b.north - b.south;
  const west = clamp(b.west + dLng, -180, 180 - w);
  const south = clamp(b.south + dLat, -90, 90 - h);
  const r = (x: number) => Math.round(x * 100) / 100;
  return { west: r(west), east: r(west + w), south: r(south), north: r(south + h) };
}

/**
 * Rectangle selection on the map.
 *  - "Draw area" mode (store.drawing) or Shift+drag draws a new rectangle.
 *  - Dragging the rectangle's outline moves it; dragging inside it pans the map as usual.
 * Map drag-pan is disabled while a gesture is in progress.
 */
export function useBoxSelect(map: MlMap | null) {
  useEffect(() => {
    if (!map) return;
    let gesture: Gesture | null = null;
    let draft: BBox | null = null;
    const canvas = map.getCanvasContainer();

    let edgeHover = false;
    const setEdgeHover = (on: boolean) => {
      if (on === edgeHover || !map.style || !map.getLayer(BBOX_LINE)) return;
      edgeHover = on;
      map.setPaintProperty(BBOX_LINE, 'line-width', on ? 3.5 : 2.5);
    };

    const begin = (e: MapMouseEvent | MapTouchEvent, shift: boolean) => {
      const { drawing, bbox } = useStore.getState();
      if (drawing || shift) {
        gesture = { kind: 'draw', start: e.lngLat };
      } else if (bbox && nearOutline(map, bbox, e.point)) {
        gesture = { kind: 'move', anchor: e.lngLat, original: bbox };
      } else {
        return;
      }
      e.preventDefault();
      map.dragPan.disable();
      draft = null;
    };

    const update = (lngLat: LngLat) => {
      if (!gesture) return;
      draft =
        gesture.kind === 'draw'
          ? normalizeBBox(gesture.start, lngLat)
          : shifted(gesture.original, lngLat.lng - gesture.anchor.lng, lngLat.lat - gesture.anchor.lat);
      setBBoxData(map, draft);
    };

    const finish = () => {
      if (!gesture) return;
      const s = useStore.getState();
      const small = draft && (draft.east - draft.west < mapConfig.minBoxDegrees || draft.north - draft.south < mapConfig.minBoxDegrees);
      if (draft && !small) {
        s.setBBox(draft);
        if (gesture.kind === 'draw') s.set({ drawing: false });
      } else {
        setBBoxData(map, s.bbox); // too small or no movement: put the old box back
      }
      gesture = null;
      draft = null;
      if (!useStore.getState().drawing) map.dragPan.enable();
    };

    const onMouseDown = (e: MapMouseEvent) => {
      if (e.originalEvent.button !== 0) return;
      begin(e, e.originalEvent.shiftKey);
    };
    const onTouchStart = (e: MapTouchEvent) => {
      if (e.points.length === 1) begin(e, false);
    };
    const onMove = (e: MapMouseEvent | MapTouchEvent) => {
      if (gesture) {
        update(e.lngLat);
        return;
      }
      // Hover affordance: move cursor + a heavier outline while the edge is grabbable.
      const { drawing, bbox } = useStore.getState();
      const shift = 'shiftKey' in e.originalEvent && (e.originalEvent as MouseEvent).shiftKey;
      const edge = !drawing && !shift && !!bbox && nearOutline(map, bbox, e.point);
      setEdgeHover(edge);
      if (drawing || shift) canvas.style.cursor = 'crosshair';
      else if (edge) canvas.style.cursor = 'move';
      else canvas.style.cursor = '';
    };
    // Holding Shift arms drawing: switch off drag-pan so maplibre never starts a pan on that press.
    const onShift = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' || gesture) return;
      if (e.type === 'keydown') {
        map.dragPan.disable();
        canvas.style.cursor = 'crosshair';
      } else if (!useStore.getState().drawing) {
        map.dragPan.enable();
        canvas.style.cursor = '';
      }
    };
    // A Shift keyup can be lost (e.g. window switch); never leave panning disabled by accident.
    const onBlur = () => {
      if (!gesture && !useStore.getState().drawing) {
        map.dragPan.enable();
        canvas.style.cursor = '';
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (gesture) {
          gesture = null;
          draft = null;
          setBBoxData(map, useStore.getState().bbox);
          map.dragPan.enable();
        }
        if (useStore.getState().drawing) useStore.getState().set({ drawing: false });
      }
    };

    map.boxZoom.disable(); // Shift+drag is ours
    map.on('mousedown', onMouseDown);
    map.on('touchstart', onTouchStart);
    map.on('mousemove', onMove);
    map.on('touchmove', onMove);
    map.on('mouseup', finish);
    map.on('touchend', finish);
    window.addEventListener('mouseup', finish);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onShift);
    window.addEventListener('keyup', onShift);
    window.addEventListener('blur', onBlur);

    // Draw mode: crosshair + no panning at all, so a drag never moves the map.
    const unsub = useStore.subscribe((s, prev) => {
      if (s.drawing === prev.drawing) return;
      canvas.style.cursor = s.drawing ? 'crosshair' : '';
      if (s.drawing) map.dragPan.disable();
      else if (!gesture) map.dragPan.enable();
    });

    return () => {
      map.off('mousedown', onMouseDown);
      map.off('touchstart', onTouchStart);
      map.off('mousemove', onMove);
      map.off('touchmove', onMove);
      map.off('mouseup', finish);
      map.off('touchend', finish);
      window.removeEventListener('mouseup', finish);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onShift);
      window.removeEventListener('keyup', onShift);
      window.removeEventListener('blur', onBlur);
      unsub();
    };
  }, [map]);
}
