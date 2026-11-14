/** Number formatting for stats: enough digits to be useful, never 12 decimals. */
export function fmt(x: number | null | undefined, sig = 3): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '–';
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1000) return x.toFixed(0);
  if (a >= 100) return x.toFixed(1);
  const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(a)));
  return Number(x.toFixed(Math.min(digits, 6))).toString().replace('-', '−');
}

export function fmtSigned(x: number, sig = 3): string {
  const s = fmt(x, sig);
  return x > 0 ? `+${s}` : s;
}

export function fmtP(p: number): string {
  if (!Number.isFinite(p)) return '–';
  return p < 0.001 ? '< 0.001' : p.toFixed(3);
}

/** Units suffix with a leading space, empty for dimensionless quantities. */
export function unitSuffix(units: string): string {
  return !units || units === 'unitless' || units === 'index' ? '' : ` ${units}`;
}

export function yearOf(date: string): string {
  return date.slice(0, 4);
}

/** "p < 0.001" or "p = 0.032". */
export function pText(p: number): string {
  return p < 0.001 ? 'p < 0.001' : `p = ${fmtP(p)}`;
}
