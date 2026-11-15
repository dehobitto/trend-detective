import type { ReactNode } from 'react';
import './components.css';

export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'rise' | 'fall'; title?: string }) {
  return (
    <span className={`badge badge--${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return <span className="chip">{children}</span>;
}
