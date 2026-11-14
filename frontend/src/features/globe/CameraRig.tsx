import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { DirectionalLight, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { globeConfig } from '../../config/globe';
import { useReducedMotion } from '../../config/motion';
import { clampLat, latLonToVector3, vector3ToLatLon } from '../../lib/geo';
import { useStore } from '../../state/store';

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
const Y = new Vector3(0, 1, 0);
const tmp = new Vector3();
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
    const lift = size.width < 760 ? 0.1 : globeConfig.verticalLift;
    camera.setViewOffset(size.width, size.height, 0, size.height * lift, size.width, size.height);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  const controls = useRef<OrbitControlsImpl>(null);
  const sun = useRef<DirectionalLight>(null);
  const flight = useRef<Flight | null>(null);
  const resumeTimer = useRef<number>();
  const reduced = useReducedMotion();

  const transition = useStore((s) => s.transition);
  const focus = useStore((s) => s.focus);

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
        s.flyTo(vector3ToLatLon(camera.position));
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
    if (sun.current) {
      tmp.copy(camera.position).normalize().applyAxisAngle(Y, -0.75);
      tmp.y += 0.35;
      sun.current.position.copy(tmp.multiplyScalar(10));
    }
  });

  return (
    <>
      <ambientLight intensity={0.16} color="#9fb4ff" />
      <directionalLight ref={sun} intensity={2.6} color="#fff6ea" />
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
