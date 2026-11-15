import type React from 'react';

/** Tilt toward the pointer, and sink at the point that is pressed (a soft physical card). */
export const pressable = {
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    // Wide pills: scale the tilt by the aspect ratio so both axes feel the same under the finger.
    const k = el.dataset.pressed === 'true' ? 14 : 8;
    const aspect = Math.min(1, r.height / r.width) * 2.2;
    el.style.setProperty('--rx', `${(-ny * k).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${(nx * k * Math.min(1, aspect)).toFixed(2)}deg`);
    el.style.setProperty('--mx', `${((nx + 1) * 50).toFixed(1)}%`);
    el.style.setProperty('--my', `${((ny + 1) * 50).toFixed(1)}%`);
  },
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
    e.currentTarget.dataset.pressed = 'true';
    pressable.onPointerMove(e);
  },
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
    e.currentTarget.dataset.pressed = 'false';
  },
  onPointerLeave: (e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    el.dataset.pressed = 'false';
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  },
};
