import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
  loadingText?: string;
  icon?: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', block, loading, loadingText, icon, className = '', children, disabled, ...rest }: Props) {
  const cls = [
    'btn',
    variant !== 'secondary' ? `btn--${variant}` : '',
    size !== 'md' ? `btn--${size}` : '',
    block ? 'btn--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spinner" aria-hidden="true" /> : icon}
      <span>{loading && loadingText ? loadingText : children}</span>
    </button>
  );
}
