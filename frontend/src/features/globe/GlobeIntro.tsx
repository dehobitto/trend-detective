import { useFrame, useThree } from '@react-three/fiber';
import { useRef, type ReactNode } from 'react';
import { Vector3, type Group, type PerspectiveCamera } from 'three';
import { prefersReducedMotion } from '../../config/motion';

/** How long the Earth takes to glide in from the right edge, ms. */
const INTRO_MS = 2000;
const side = new Vector3();
/** Share of the flight after which the hero's "where?" shows up, so it lands together with the Earth. */
const CUE_AT = 0.55;

/** Tell the page (CSS: html[data-globe-in]) that the Earth is arriving. */
function cue() {
  document.documentElement.dataset.globeIn = 'true';
}

/**
 * First appearance of the Earth: instead of popping in once its textures load, it glides in from beyond the
 * right edge of the screen and settles in the centre (ease-out). Plays once per page load.
 */
export function GlobeIntro({ children }: { children: ReactNode }) {
  const group = useRef<Group>(null);
  const start = useRef<number | null>(null);
  const done = useRef(prefersReducedMotion());
  const camera = useThree((s) => s.camera) as PerspectiveCamera;

  useFrame(({ clock, size }) => {
    const g = group.current;
    if (!g) return;
    if (done.current) {
      if (!document.documentElement.dataset.globeIn) cue();
      return;
    }
    const now = clock.getElapsedTime() * 1000;
    if (start.current === null) start.current = now;
    const t = Math.min(1, (now - start.current) / INTRO_MS);
    const e = 1 - Math.pow(1 - t, 3);
    if (t >= CUE_AT && !document.documentElement.dataset.globeIn) cue();
    // Start just past the right edge, in screen terms (whatever direction the camera faces).
    const halfW = camera.position.length() * Math.tan(((camera.fov / 2) * Math.PI) / 180) * (size.width / size.height);
    // Well past the edge: the near side of the sphere and the glow sit closer to the camera, so they reach further.
    const from = halfW * 3 + 6;
    side.set(1, 0, 0).applyQuaternion(camera.quaternion);
    g.position.copy(side).multiplyScalar(from * (1 - e));
    if (t >= 1) {
      g.position.set(0, 0, 0);
      done.current = true;
    }
  });

  return <group ref={group} position={done.current ? [0, 0, 0] : [100, 0, 0]}>{children}</group>;
}
