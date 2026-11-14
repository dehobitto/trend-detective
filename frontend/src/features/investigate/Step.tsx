import type { ReactNode } from 'react';

type Props = { n: number; title: string; done?: boolean; active?: boolean; children: ReactNode; aside?: ReactNode };

/** One numbered step of the investigation. Numbers are real here: the flow is a sequence. */
export function Step({ n, title, done, active, children, aside }: Props) {
  return (
    <section className="step" data-done={done} data-active={active} aria-labelledby={`step-${n}`}>
      <header className="step__head">
        <span className="step__num" aria-hidden>
          {n}
        </span>
        <h2 id={`step-${n}`} className="step__title">
          {title}
        </h2>
        {aside && <div className="step__aside">{aside}</div>}
      </header>
      <div className="step__body">{children}</div>
    </section>
  );
}
