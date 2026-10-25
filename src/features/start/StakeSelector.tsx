import { useRef } from 'react';
import gsap from 'gsap';
import { STAKE_OPTIONS_CENTS, type StakeCents } from '../../domain/types';
import { formatCents } from '../../domain/money';
import { usePreferences } from '../../state/preferences';
import { IconCheck } from '../../ui/Icons';

const COINS: Record<StakeCents, number> = { 100: 1, 200: 2, 500: 3 };

interface Props {
  value: StakeCents | null;
  onChange: (value: StakeCents) => void;
  disabled?: boolean;
  name?: string;
}

/** Drei gleichwertige Auswahlkarten (1 €, 2 €, 5 €) als native Radiogruppe – tastatur- und screenreaderfähig. */
export function StakeSelector({ value, onChange, disabled, name = 'stake' }: Props) {
  const group = useRef<HTMLDivElement>(null);
  const { reducedMotion } = usePreferences();

  const select = (stake: StakeCents, el: HTMLElement | null) => {
    onChange(stake);
    if (!reducedMotion && el) {
      gsap.fromTo(el, { scale: 0.96 }, { scale: 1, duration: 0.45, ease: 'back.out(3)', clearProps: 'transform' });
    }
  };

  return (
    <div ref={group} className="stakes" role="radiogroup" aria-label="Einsatz für diese Partie" aria-required="true">
      {STAKE_OPTIONS_CENTS.map((stake) => {
        const checked = value === stake;
        return (
          <label key={stake} className={`stake ${checked ? 'stake--checked' : ''}`} data-testid={`stake-${stake}`}>
            <input
              type="radio"
              name={name}
              value={stake}
              checked={checked}
              disabled={disabled}
              onChange={(e) => select(stake, e.currentTarget.parentElement)}
            />
            <span className="stake__coins" aria-hidden="true">
              {Array.from({ length: COINS[stake] }, (_, i) => (
                <span key={i} className="stake__coin" />
              ))}
            </span>
            <span className="stake__amount">{formatCents(stake).replace(',00', '')}</span>
            <span className="stake__caption">{formatCents(stake)} pro Partie</span>
            <span className="stake__check" aria-hidden="true">
              <IconCheck />
            </span>
          </label>
        );
      })}
    </div>
  );
}
