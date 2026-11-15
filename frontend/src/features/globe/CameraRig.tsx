import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { PerspectiveCamera, Quaternion, Spherical, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { globeConfig } from '../../config/globe';
import { useReducedMotion } from '../../config/motion';
import { clampLat, latLonToVector3, vector3ToLatLon } from '../../lib/geo';
import { useStore } from '../../state/store';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { globeScreenOffset, handoff } from './handoff';
import { globeUniforms, liveSunVector, useSun } from './sun';
import { createWheelClassifier } from './wheelIntent';

type Flight = {
  fromDir: Vector3;
  rot: Quaternion; // rotation taking fromDir to toDir
  fromDist: number;
  toDist: number;
  t0: number;
  dur: number;
  done: () => void;
};

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const camDir = new Vector3();
const camRight = new Vector3();
const camUp = new Vector3();
const studioSun = new Vector3();
const qIdentity = new Quaternion();
const qStep = new Quaternion();
const sph = new Spherical();
const gcfg = globeConfig.gestures;

/**
 * Owns the camera: orbit controls, idle auto-rotation, the "sun" that follows the viewer,
 * the zoom-threshold hand-off to the map, and the fly-in / fly-out animations.
 */
export function CameraRig() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const domElement = useThree((s) => s.gl.domElement);
  /** Two-finger trackpad swipe: input this frame (radians) and the coasting velocity after it. */
  const swipe = useRef({ theta: 0, phi: 0, vTheta: 0, vPhi: 0, active: false });
  const size = useThree((s) => s.size);
  // Rest distance that keeps the whole globe in frame on narrow (portrait) screens too.
  const restDistance = useMemo(() => {
    const aspect = size.width / Math.max(1, size.height);
    if (size.width >= globeConfig.sideDock.minWidth) return globeConfig.sideDock.distance; // big globe beside the headline
    const halfH = Math.tan(((globeConfig.fov / 2) * Math.PI) / 180) * Math.min(1, aspect);
    return Math.max(globeConfig.defaultDistance, 1.12 / halfH);
  }, [size.width, size.height]);
  const restRef = useRef(restDistance);
  restRef.current = restDistance;

  // Lift the globe a little so the case-file prompt docked at the bottom never covers its centre.
  useEffect(() => {
    // Wide screens dock the case index on the left, so the globe moves right and sits centred vertically.
    // (handoff.globeScreenOffset is the single source; it is re-applied every frame as the distance changes.)
    const { dx, dy } = globeScreenOffset(size.width, size.height, camera.position.length());
    camera.setViewOffset(size.width, size.height, -dx, -dy, size.width, size.height);
    camera.updateProjectionMatrix();
    lastOffset.current = `${dx},${dy}`;
  }, [camera, size.width, size.height]);
  const controls = useRef<OrbitControlsImpl>(null);
  const flight = useRef<Flight | null>(null);
  const lastOffset = useRef('');
  const resumeTimer = useRef<number>();
  const reduced = useReducedMotion();

  const transition = useStore((s) => s.transition);
  const focus = useStore((s) => s.focus);
  const peek = useStore((s) => s.peek);

  if (import.meta.env.DEV) (window as unknown as { __tdCamera: PerspectiveCamera }).__tdCamera = camera; // tests / screenshots

  // Initial framing.
  useEffect(() => {
    const { lat, lon } = globeConfig.initialFocus;
    latLonToVector3(lat, lon, restRef.current, camera.position);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  // Respect reduced motion for idle rotation.
  useEffect(() => {
    if (controls.current) controls.current.autoRotate = !reduced;
  }, [reduced]);

  const startFlight = (toDir: Vector3, toDist: number, done: () => void, fromDirOverride?: Vector3) => {
    const fromDir = (fromDirOverride ?? camera.position).clone().normalize();
    const rot = new Quaternion().setFromUnitVectors(fromDir, toDir.clone().normalize());
    flight.current = {
      fromDir,
      rot,
      fromDist: camera.position.length(),
      toDist,
      t0: performance.now(),
      dur: reduced ? 0 : globeConfig.flyDurationMs,
      done,
    };
    if (controls.current) {
      controls.current.enabled = false;
      controls.current.autoRotate = false;
    }
  };

  // React to store-driven transitions.
  useEffect(() => {
    const target = latLonToVector3(clampLat(focus.lat), focus.lon, 1);
    if (transition === 'flyingIn') {
      // Crossfade only once the map has its tiles for this spot (it pre-positions at the start of the flight),
      // so the fade never reveals an empty map. Give up waiting after a moment.
      startFlight(target, globeConfig.arrivalDistance, () => {
        const t0 = performance.now();
        const go = () => (handoff.full || performance.now() - t0 > 700 ? useStore.getState().arriveAtMap() : window.setTimeout(go, 50));
        go();
      });
    } else if (transition === 'flyingOut') {
      // Start over the place we left the map, as far out as the map was zoomed (same scale), then pull back out.
      const exit = useStore.getState().exitDistance;
      const startDist = Math.min(restRef.current, Math.max(globeConfig.minDistance, exit ?? globeConfig.arrivalDistance));
      camera.position.copy(target).multiplyScalar(startDist);
      camera.lookAt(0, 0, 0);
      startFlight(target, restRef.current, () => {
        if (controls.current) {
          controls.current.enabled = true;
          controls.current.autoRotate = !reduced;
        }
        useStore.getState().finishTransition();
      });
    }
  }, [transition]);

  // Turn the globe to face a place without zooming (e.g. the station behind a record).
  useEffect(() => {
    const s = useStore.getState();
    if (!peek || flight.current || s.transition !== 'idle' || s.view !== 'globe') return;
    const target = latLonToVector3(clampLat(peek.lat), peek.lon, 1);
    startFlight(target, camera.position.length(), () => {
      const c = controls.current;
      if (!c) return;
      c.enabled = true;
      window.clearTimeout(resumeTimer.current);
      resumeTimer.current = window.setTimeout(() => {
        if (!flight.current && !reduced) c.autoRotate = true;
      }, globeConfig.resumeRotationAfterMs);
    });
  }, [peek?.nonce]);

  // Interaction: pause rotation while the user drags/zooms, resume after a short rest.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const onStart = () => {
      window.clearTimeout(resumeTimer.current);
      c.autoRotate = false;
    };
    const onEnd = () => {
      window.clearTimeout(resumeTimer.current);
      resumeTimer.current = window.setTimeout(() => {
        if (!flight.current && !reduced) c.autoRotate = true;
      }, globeConfig.resumeRotationAfterMs);
    };
    const onChange = () => {
      const s = useStore.getState();
      if (flight.current || s.transition !== 'idle' || s.view !== 'globe') return;
      if (camera.position.length() < globeConfig.mapThreshold) {
        s.flyTo(vector3ToLatLon(camera.position), false, { via: 'wheel' });
      }
    };
    c.addEventListener('start', onStart);
    c.addEventListener('end', onEnd);
    c.addEventListener('change', onChange);
    return () => {
      c.removeEventListener('start', onStart);
      c.removeEventListener('end', onEnd);
      c.removeEventListener('change', onChange);
      window.clearTimeout(resumeTimer.current);
    };
  }, [camera, reduced]);

  // Trackpad: two-finger swipe turns the globe, pinch (ctrl+wheel) zooms; a mouse wheel keeps zooming
  // through OrbitControls. Listens on the canvas' parent in the capture phase, so it runs before OrbitControls.
  useEffect(() => {
    const host = domElement.parentElement;
    if (!host) return;
    const classify = createWheelClassifier();
    let endTimer = 0;
    const onWheel = (e: WheelEvent) => {
      const c = controls.current;
      if (!c || !c.enabled || flight.current) return;
      const intent = classify(e);
      if (intent === 'zoom' && !e.ctrlKey) return; // mouse wheel: OrbitControls' own dolly
      e.preventDefault();
      e.stopPropagation();
      window.clearTimeout(resumeTimer.current);
      c.autoRotate = false;
      if (intent === 'zoom') {
        const k = Math.exp(-Math.min(Math.abs(e.deltaY), 50) * gcfg.pinchZoomPerDelta);
        if (e.deltaY < 0) c.dollyIn(k);
        else if (e.deltaY > 0) c.dollyOut(k);
      } else {
        // Slower when close to the ground, so the surface keeps up with the fingers.
        const dist = camera.position.length();
        const scale = gcfg.swipeRadPerPx * Math.max(0.12, Math.min(1.2, (dist - 1) / (restRef.current - 1)));
        swipe.current.theta += e.deltaX * scale;
        swipe.current.phi += e.deltaY * scale;
        swipe.current.active = true;
      }
      window.clearTimeout(endTimer);
      endTimer = window.setTimeout(() => {
        resumeTimer.current = window.setTimeout(() => {
          if (!flight.current && !reduced && controls.current) controls.current.autoRotate = true;
        }, globeConfig.resumeRotationAfterMs);
      }, gcfg.gestureGapMs);
    };
    host.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => {
      host.removeEventListener('wheel', onWheel, { capture: true });
      window.clearTimeout(endTimer);
    };
  }, [domElement, camera, reduced]);

  useFrame((_, dt) => {
    // Apply the swipe (and its inertia) by orbiting the camera; OrbitControls picks the new position up.
    const sw = swipe.current;
    if (sw.active || Math.abs(sw.vTheta) + Math.abs(sw.vPhi) > 1e-5) {
      let dTheta: number;
      let dPhi: number;
      if (sw.active) {
        dTheta = sw.theta;
        dPhi = sw.phi;
        const frames = Math.max(1, Math.min(dt, 0.1) * 60);
        sw.vTheta = reduced ? 0 : dTheta / frames;
        sw.vPhi = reduced ? 0 : dPhi / frames;
      } else {
        const decay = Math.pow(gcfg.swipeFriction, Math.min(dt, 0.1) * 60);
        sw.vTheta *= decay;
        sw.vPhi *= decay;
        dTheta = sw.vTheta * Math.min(dt, 0.1) * 60;
        dPhi = sw.vPhi * Math.min(dt, 0.1) * 60;
      }
      sw.theta = sw.phi = 0;
      sw.active = false;
      if (!flight.current) {
        sph.setFromVector3(camera.position);
        sph.theta += dTheta;
        sph.phi = Math.max(gcfg.minPolar, Math.min(gcfg.maxPolar, sph.phi + dPhi));
        camera.position.setFromSpherical(sph);
        camera.lookAt(0, 0, 0);
        controls.current?.update();
      } else sw.vTheta = sw.vPhi = 0;
    }
    const f = flight.current;
    if (f) {
      const t = f.dur === 0 ? 1 : Math.min(1, (performance.now() - f.t0) / f.dur);
      const e = easeInOutCubic(t);
      qStep.copy(qIdentity).slerp(f.rot, e);
      const dist = f.fromDist + (f.toDist - f.fromDist) * e;
      camera.position.copy(f.fromDir).applyQuaternion(qStep).multiplyScalar(dist);
      camera.lookAt(0, 0, 0);
      if (t >= 1) {
        flight.current = null;
        f.done();
      }
    }
    // The wallpaper-style side shift fades as the camera comes down (centred at the hand-off).
    {
      const { dx, dy } = globeScreenOffset(size.width, size.height, camera.position.length());
      const key = `${dx},${dy}`;
      if (key !== lastOffset.current) {
        lastOffset.current = key;
        camera.setViewOffset(size.width, size.height, -dx, -dy, size.width, size.height);
        camera.updateProjectionMatrix();
      }
    }

    {
      const d = camera.position.length();
      const g = Math.min(1, Math.max(0, (globeConfig.gridFrom - d) / (globeConfig.gridFrom - globeConfig.gridFull)));
      globeUniforms.uGrid.value = g;
    }

    // Hand-off: while flying in or out, drape the map's picture over the landing spot as the camera nears it.
    {
      const s = useStore.getState();
      const m = handoff.map;
      let k = 0;
      if (m && s.transition !== 'idle' && handoff.ready) {
        const d = camera.position.length();
        const t = Math.min(1, Math.max(0, (globeConfig.handoffStartDistance - d) / (globeConfig.handoffStartDistance - globeConfig.arrivalDistance)));
        k = t * t * (3 - 2 * t);
      }
      globeUniforms.uHandoff.value = k;
      if (k > 0 && m) {
        const canvas = m.getCanvas();
        const tex = globeUniforms.uMapTex;
        if (tex.value.image !== canvas) {
          const t = new CanvasTexture(canvas);
          t.colorSpace = SRGBColorSpace;
          tex.value = t;
        }
        tex.value.needsUpdate = true;
        const c = m.getCenter();
        const lat = (Math.max(-85, Math.min(85, c.lat)) * Math.PI) / 180;
        globeUniforms.uMapCenter.value.set((c.lng + 180) / 360, 0.5 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / (2 * Math.PI));
        const world = 512 * Math.pow(2, m.getZoom());
        const el = m.getContainer();
        globeUniforms.uMapScale.value.set(world / Math.max(1, el.clientWidth), world / Math.max(1, el.clientHeight));
      }
    }

    // Where we look, for the hidden map to preload there.
    const look = vector3ToLatLon(camera.position);
    handoff.look.lat = look.lat;
    handoff.look.lon = look.lon;
    handoff.look.distance = camera.position.length();

    // The sun sits up and to the left of the viewer, so the visible face is lit with a soft terminator on the right.
    camDir.copy(camera.position).normalize();
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    camUp.setFromMatrixColumn(camera.matrixWorld, 1);
    // Studio light: the sun sits up and to the left of the viewer.
    const { sunAzimuth: az, sunElevation: el } = globeConfig;
    studioSun
      .copy(camDir)
      .multiplyScalar(Math.cos(az) * Math.cos(el))
      .addScaledVector(camRight, -Math.sin(az) * Math.cos(el))
      .addScaledVector(camUp, Math.sin(el))
      .normalize();
    const sun = useSun.getState();
    if (sun.live) {
      // The real Sun (day and night as they are now), easing into studio light as the camera comes down to the
      // ground: the place you dive into is daylit like the map you land on, so the crossfade has no dark-to-bright jump.
      liveSunVector(Date.now(), globeUniforms.uSun.value);
      const near = Math.min(1, Math.max(0, (restRef.current * 0.8 - camera.position.length()) / (restRef.current * 0.8 - globeConfig.arrivalDistance)));
      const k = near * near * (3 - 2 * near);
      globeUniforms.uSun.value.lerp(studioSun, k).normalize();
      globeUniforms.uMoon.value = globeConfig.moonlight * (1 - k);
    } else {
      globeUniforms.uSun.value.copy(studioSun);
      globeUniforms.uMoon.value = 0;
    }
  });

  return (
    <>
      <OrbitControls
        ref={controls}
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.5}
        zoomSpeed={0.7}
        minDistance={globeConfig.minDistance}
        minPolarAngle={gcfg.minPolar}
        maxPolarAngle={gcfg.maxPolar}
        maxDistance={restDistance} // never further out than the default framing
        autoRotate={!reduced}
        autoRotateSpeed={globeConfig.autoRotateSpeed}
      />
    </>
  );
}
