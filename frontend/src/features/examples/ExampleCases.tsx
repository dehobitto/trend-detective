import { useState } from 'react';
import type { ExampleCase } from '../../api/types';
import { useStore } from '../../state/store';
import './examples.css';

/**
 * The "case file" prompt on the globe screen. Picking a case flies the globe there and
 * opens the map with the area and variable already chosen.
 */
export function ExampleCases() {
  const examples = useStore((s) => s.examples);
  const applyExample = useStore((s) => s.applyExample);
  const transition = useStore((s) => s.transition);
  const [focused, setFocused] = useState<ExampleCase | null>(null);
  const busy = transition !== 'idle';

  return (
    <section className="cases" aria-labelledby="cases-title">
      <h2 id="cases-title" className="cases__title">
        Pick a place to investigate
      </h2>
      <p className="cases__lede" aria-live="polite">
        {focused ? focused.question : 'Click anywhere on Earth, or open a case file.'}
      </p>
      <div className="cases__list" onMouseLeave={() => setFocused(null)}>
        {examples.map((ex) => (
          <button
            key={ex.id}
            type="button"
            className="case"
            disabled={busy}
            onMouseEnter={() => setFocused(ex)}
            onFocus={() => setFocused(ex)}
            onBlur={() => setFocused(null)}
            onClick={() => applyExample(ex)}
          >
            {ex.title}
          </button>
        ))}
      </div>
      <p className="cases__how">Drag to turn the globe. Scroll in to dive down to the map.</p>
    </section>
  );
}
