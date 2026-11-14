import { useId } from 'react';
import './components.css';

type Props = { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean };

/** Accessible switch (a checkbox with role="switch"). */
export function Toggle({ checked, onChange, label, disabled }: Props) {
  const id = useId();
  return (
    <label className="toggle" htmlFor={id} data-disabled={disabled}>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle__track" aria-hidden>
        <span className="toggle__thumb" />
      </span>
      <span className="toggle__label">{label}</span>
    </label>
  );
}
