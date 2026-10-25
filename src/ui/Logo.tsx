export function LogoMark({ className = 'brand__mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect x="9" y="11" width="28" height="28" rx="7" transform="rotate(-10 23 25)" fill="var(--c-felt)" />
      <rect x="11" y="9" width="28" height="28" rx="7" transform="rotate(6 25 23)" fill="var(--c-die)" stroke="var(--c-ink)" strokeWidth="2" />
      <g fill="var(--c-ink)" transform="rotate(6 25 23)">
        <circle cx="18" cy="16" r="2.4" />
        <circle cx="32" cy="16" r="2.4" />
        <circle cx="25" cy="23" r="2.4" />
        <circle cx="18" cy="30" r="2.4" />
        <circle cx="32" cy="30" r="2.4" />
      </g>
    </svg>
  );
}
