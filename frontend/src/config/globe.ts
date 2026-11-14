/** 3D globe tunables. Earth radius is 1 scene unit. */
export const globeConfig = {
  textures: {
    color: '/textures/earth-blue-marble.jpg',
    bump: '/textures/earth-topology.png',
    water: '/textures/earth-water.png',
    sky: '/textures/night-sky.png',
  },
  fov: 40,
  /** Resting camera distance from Earth's centre (raised automatically on portrait screens). */
  defaultDistance: 3.7,
  /** Shift the globe up by this fraction of the viewport height (room for the case-file prompt). */
  verticalLift: 0.06,
  /** Closest / farthest the user can wheel-zoom. */
  minDistance: 1.25,
  maxDistance: 6,
  /** Wheel-zooming closer than this hands off to the 2D map. */
  mapThreshold: 1.75,
  /** Where the fly-in ends (just before the crossfade). */
  arrivalDistance: 1.35,
  /** OrbitControls autoRotateSpeed (2.0 = one turn per 30 s at 60 fps). */
  autoRotateSpeed: 0.35,
  /** Resume auto-rotation this long after the user stops interacting. */
  resumeRotationAfterMs: 4000,
  /** Fly-to duration before the crossfade. */
  flyDurationMs: 1000,
  /** Initial camera focus. */
  initialFocus: { lat: 18, lon: 12 },
  /** A click only counts if the pointer moved fewer than this many px (otherwise it was a drag). */
  clickTolerancePx: 5,
  bumpScale: 3.2,
  shininess: 18,
  atmosphereScale: 1.12,
  /** Brightness of the outer atmosphere glow. */
  atmosphereStrength: 0.95,
} as const;
