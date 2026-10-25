import type { ReactNode } from 'react';
import { DiceFace } from './DiceFace';

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div style={{ display: 'flex', gap: 10, transform: 'rotate(-4deg)' }} aria-hidden="true">
        <DiceFace value={5} size="lg" />
        <span style={{ transform: 'translateY(10px) rotate(12deg)' }}>
          <DiceFace value={2} size="lg" />
        </span>
        <DiceFace value={6} size="lg" />
      </div>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
