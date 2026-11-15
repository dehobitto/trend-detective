import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { globeConfig } from '../../config/globe';
import { useReducedMotion } from '../../config/motion';
import { clampLat, latLonToVector3, vector3ToLatLon } from '../../lib/geo';
import { useStore } from '../../state/store';
import { globeUniforms } from './sun';

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
const qIdentity = new Quaternion();
const qStep = new Quaternion();

/**
 * Owns the camera: orbit controls, idle auto-rotation, the "sun" that follows the viewer,
 * the zoom-threshold hand-off to the map, and the fly-in / fly-out animations.
 */
export function CameraRig() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  // Rest distance that keeps the whole globe in frame on narrow (portrait) screens too.
  const restDistance = useMemo(() => {
    const aspect = size.width / Math.max(1, size.height);
    const halfH = Math.tan(((globeConfig.fov / 2) * Math.PI) / 180) * Math.min(1, aspect);
    return Math.max(globeConfig.defaultDistance, 1.12 / halfH);
  }, [size.width, size.height]);
  const restRef = useRef(restDistance);
  restRef.current = restDistance;

  // Lift the globe a little so the case-file prompt docked at the bottom never covers its centre.
  useEffect(() => {
    // Wide screens dock the case index on the left, so the globe moves right and sits centred vertically.
    const docked = size.width >= globeConfig.sideDock.minWidth;
    const lift = size.width < 760 ? 0.1 : docked ? 0 : globeConfig.verticalLift;
    const shift = docked ? globeConfig.sideDock.shiftPx : 0;
    camera.setViewOffset(size.width, size.height, -shift, size.height * lift, size.width, size.height);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  const controls = useRef<OrbitControlsImpl>(null);
  const flight = useRef<Flight | null>(null);
  const resumeTimer = useRef<number>();
  const reduced = useReducedMotion();

  const transition = useStore((s) => s.transition);
  const focus = useStore((s) => s.focus);
  const peek = useStore((s) => s.peek);

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
      startFlight(target, globeConfig.arrivalDistance, () => useStore.getState().arriveAtMap());
    } else if (transition === 'flyingOut') {
      // Start close over the place we left the map, then pull back out.
      camera.position.copy(target).multiplyScalar(globeConfig.arrivalDistance);
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

  useFrame(() => {
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
    // The sun sits up and to the left of the viewer, so the visible face is lit with a soft terminator on the right.
    camDir.copy(camera.position).normalize();
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    camUp.setFromMatrixColumn(camera.matrixWorld, 1);
    const { sunAzimuth: az, sunElevation: el } = globeConfig;
    globeUniforms.uSun.value
      .copy(camDir)
      .multiplyScalar(Math.cos(az) * Math.cos(el))
      .addScaledVector(camRight, -Math.sin(az) * Math.cos(el))
      .addScaledVector(camUp, Math.sin(el))
      .normalize();
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
        maxDistance={Math.max(globeConfig.maxDistance, restDistance * 1.4)}
        autoRotate={!reduced}
        autoRotateSpeed={globeConfig.autoRotateSpeed}
      />
    </>
  );
}
