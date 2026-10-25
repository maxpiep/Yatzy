import type { DieValue } from '../domain/types';

const PIPS: Record<DieValue, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[27, 27], [50, 50], [73, 73]],
  4: [[29, 29], [71, 29], [29, 71], [71, 71]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[29, 26], [71, 26], [29, 50], [71, 50], [29, 74], [71, 74]],
};

export const DIE_WORDS: Record<DieValue, string> = { 1: 'Eins', 2: 'Zwei', 3: 'Drei', 4: 'Vier', 5: 'Fünf', 6: 'Sechs' };

interface Props {
  value: DieValue | null;
  size?: 'sm' | 'md' | 'lg';
  held?: boolean;
  draft?: boolean;
  active?: boolean;
  /** Zugängliche Beschriftung; ohne Angabe dekorativ. */
  label?: string;
}

/** Würfel mit echten Augen (SVG). Leere Würfel zeigen einen gestrichelten Platzhalter. */
export function DiceFace({ value, size = 'md', held, draft, active, label }: Props) {
  const cls = [
    'die',
    `die--${size}`,
    value === null ? 'die--empty' : '',
    held ? 'die--held' : '',
    draft && value !== null ? 'die--draft' : '',
    active ? 'die--active' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {value === null ? (
        <span aria-hidden="true">?</span>
      ) : (
        <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
          {PIPS[value].map(([cx, cy], i) => (
            <circle key={i} className="die__pip" cx={cx} cy={cy} r={value === 1 ? 11 : 9.5} />
          ))}
        </svg>
      )}
    </span>
  );
}

export function DiceRow({ dice, size = 'sm' }: { dice: readonly number[]; size?: 'sm' | 'md' }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4 }} role="img" aria-label={`Würfel: ${dice.join(', ')}`}>
      {dice.map((d, i) => (
        <DiceFace key={i} value={d as DieValue} size={size} />
      ))}
    </span>
  );
}
