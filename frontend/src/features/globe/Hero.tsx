/**
 * The home screen headline, left of the globe (wide screens only). Display face: --font-display.
 */
export function Hero() {
  return (
    <section className="hero" aria-label="Trend Detective">
      <p className="hero__kicker">25 years of NASA Earth data</p>
      <h2 className="hero__title">
        <span>Earth's</span>
        <span>changing.</span>
        <span>
          But <em>where?</em>
        </span>
      </h2>
      <p className="hero__lede">Pick a place and a measurement. We test whether the change is real or just the usual ups and downs.</p>
      <p className="hero__hint">Turn the globe and click anywhere, or search for a place.</p>
    </section>
  );
}
