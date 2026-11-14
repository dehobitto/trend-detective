import './components.css';

/** Top-left identity. The mark is a tiny rising line over a disc: the whole product in one glyph. */
export function Wordmark() {
  return (
    <header className="wordmark">
      <svg className="wordmark__mark" viewBox="0 0 32 32" aria-hidden>
        <circle cx="16" cy="16" r="13" fill="none" stroke="var(--line-strong)" strokeWidth="1.5" />
        <path d="M6 21 L12.5 15.5 L17.5 18.5 L26 9.5" fill="none" stroke="var(--rise)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div>
        <h1 className="wordmark__name">Trend Detective</h1>
        <p className="wordmark__sub">Is it really changing? Ask NASA's data.</p>
      </div>
    </header>
  );
}
