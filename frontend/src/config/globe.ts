/** 3D globe tunables. Earth radius is 1 scene unit. */
export const globeConfig = {
  /** NASA imagery: Blue Marble NG (July 2004, 8192 px), Black Marble city lights, cloud alpha, water mask, relief. */
  textures: {
    day: '/textures/earth-day.jpg',
    night: '/textures/earth-night.jpg',
    clouds: '/textures/earth-clouds.jpg',
    water: '/textures/earth-water.jpg',
    bump: '/textures/earth-bump.jpg',
    /** From NASA SVS Deep Star Maps 2020 (public domain): the 4500 brightest stars [ra, dec, brightness, r, g, b]... */
    stars: '/textures/stars.json',
    /** ...and the Milky Way's diffuse light (stars removed, softened), 2048x1024. */
    milkyWay: '/textures/milkyway-glow.jpg',
  },
  fov: 40,
  /** Resting camera distance from Earth's centre (raised automatically on portrait screens). */
  defaultDistance: 3.7,
  /** Shift the globe up by this fraction of the viewport height (room for the case-file prompt). */
  verticalLift: 0.06,
  /** At this width and up the case index docks on the left; the globe shifts right by shiftPx (keep in sync with examples.css). */
  sideDock: { minWidth: 1080, shiftPx: 212, shiftFrac: 0.29, distance: 3.0 },
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
  /** Night sky behind the globe: point stars and the Milky Way glow. Kept restrained: a backdrop, not a show. */
  starBrightness: 0.85,
  milkyWayBrightness: 0.22,
  /** Live-sun mode: faint bluish light on the night side so continents stay readable under the city lights. */
  moonlight: 0.04,
  /** Cloud shell radius and drift (seconds per full turn relative to the ground). */
  cloudAltitude: 1.006,
  cloudPeriodS: 1800,
  /** Outer limb shell radius: thin, like the real ~100 km of visible air. */
  atmosphereScale: 1.018,
  /** Hairline lat/lon grid over the globe (and over data overlays). */
  graticule: { stepDeg: 30, alpha: 0.2, altitude: 1.008 },
  /** Trackpad / touch gestures (see features/globe/wheelIntent.ts). */
  gestures: {
    /** Wheel events further apart than this start a new gesture (re-classified). */
    gestureGapMs: 180,
    /** A whole, purely vertical pixel delta at least this big is a mouse-wheel notch (Chrome: 100/120, Firefox: 48+). */
    mouseMinStep: 40,
    /** Two-finger swipe: radians of globe turn per pixel of scroll at the resting distance (scaled down when close). */
    swipeRadPerPx: 0.004,
    /** Inertia after the swipe: velocity kept per 1/60 s. */
    swipeFriction: 0.9,
    /** Pinch: zoom factor per unit of deltaY (ctrlKey wheel). */
    pinchZoomPerDelta: 0.01,
    /** Polar limits (radians from the north pole) so a vertical swipe can't flip the globe over. */
    minPolar: 0.15,
    maxPolar: Math.PI - 0.15,
  },
  /** Variable layer draped over the globe (between the ground and the cloud shell). */
  overlay: {
    altitude: 1.003,
    /** GIBS WMS image width (px); height is half. */
    wmsWidth: 2048,
    /** Cross-fade between timeline frames, and fade in/out of the whole overlay. */
    crossFadeMs: 350,
    showFadeMs: 400,
    /** Cloud opacity while an overlay is shown (0 = hidden). */
    cloudAlphaWithOverlay: 0.08,
    /** Loaded frame textures kept in memory. */
    cacheSize: 10,
    /** Timeline frames preloaded on each side of the current one. */
    prefetch: 2,
  },
  /** Opacity of the limb at its densest. */
  atmosphereStrength: 0.7,
} as const;
