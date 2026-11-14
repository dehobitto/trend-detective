import type { ButtonHTMLAttributes } from 'react';
import './components.css';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'quiet' | 'ghost';
  size?: 'm' | 's';
};

export function Button({ variant = 'quiet', size = 'm', className = '', ...rest }: Props) {
  return <button type="button" className={`btn btn--${variant} btn--${size} ${className}`} {...rest} />;
}
