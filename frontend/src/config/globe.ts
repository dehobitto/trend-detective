/** 3D globe tunables. Earth radius is 1 scene unit. */
export const globeConfig = {
  /** NASA imagery: Blue Marble NG (July 2004, 8192 px), Black Marble city lights, cloud alpha, water mask, relief. */
  textures: {
    day: '/textures/earth-day.jpg',
    night: '/textures/earth-night.jpg',
    clouds: '/textures/earth-clouds.jpg',
    water: '/textures/earth-water.jpg',
    bump: '/textures/earth-bump.jpg',
  },
  fov: 40,
  /** Resting camera distance from Earth's centre (raised automatically on portrait screens). */
  defaultDistance: 3.7,
  /** Shift the globe up by this fraction of the viewport height (room for the case-file prompt). */
  verticalLift: 0.06,
  /** At this width and up the case index docks on the left; the globe shifts right by shiftPx (keep in sync with examples.css). */
  sideDock: { minWidth: 1080, shiftPx: 212 },
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
  /** Relief strength (normal perturbation from the height map). */
  bumpScale: 6,
  /** Exposure of the shader's soft tone curve (higher = brighter Earth). */
  exposure: 1.9,
  /** Sun direction relative to the viewer, in radians: to the left (terminator on the right edge) and up. */
  sunAzimuth: 0.74,
  sunElevation: 0.3,
  /** Cloud shell radius and drift (seconds per full turn relative to the ground). */
  cloudAltitude: 1.006,
  cloudPeriodS: 1800,
  /** Outer limb shell radius: thin, like the real ~100 km of visible air. */
  atmosphereScale: 1.035,
  /** Opacity of the limb at its densest. */
  atmosphereStrength: 0.85,
} as const;
