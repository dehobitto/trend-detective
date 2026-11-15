/** JS mirror of the CSS tokens in theme.css (charts and WebGL can't read CSS vars cheaply). */
export const colors = {
  space: '#E6EAEE',
  panel: '#F8FAFB',
  ink: '#18212B',
  inkDim: '#4E5A67',
  line: '#D3D9DF',
  rise: '#9A5200',
  fall: '#07668A',
  signif: '#18212B',
  /** Rayleigh blue of the thin limb around the globe. */
  atmosphere: '#5E9BDB',
} as const;
