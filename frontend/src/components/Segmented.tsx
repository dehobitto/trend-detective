import './components.css';

type Option<T extends string> = { value: T; label: string };
type Props<T extends string> = { value: T; options: Option<T>[]; onChange: (v: T) => void; label: string; disabled?: boolean };

/** Two-to-four way choice, rendered as a radio group. */
export function Segmented<T extends string>({ value, options, onChange, label, disabled }: Props<T>) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          className="segmented__opt"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
