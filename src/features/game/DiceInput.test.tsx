import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Roll } from '../../domain/types';
import { PreferencesProvider } from '../../state/preferences';
import { DiceInput } from './DiceInput';

const roll = (rollNo: number, dice: number[], held = [false, false, false, false, false]): Roll => ({
  id: `r${rollNo}`,
  gameId: 'g',
  turnNo: 1,
  rollNo,
  playerId: 'p',
  dice: dice as never,
  held,
  createdAt: '',
});

const setup = (rolls: Roll[], onConfirm = vi.fn(async () => {})) => {
  render(
    <PreferencesProvider>
      <DiceInput rolls={rolls} maxRolls={3} onConfirm={onConfirm} />
    </PreferencesProvider>,
  );
  return onConfirm;
};

describe('Würfeingabe für echte Würfel', () => {
  it('bestätigt erst nach fünf Werten; Entwurf ist als solcher gekennzeichnet', async () => {
    const onConfirm = setup([]);
    expect(screen.getByTestId('roll-state')).toHaveTextContent('Entwurf · Wurf 1');
    for (const v of [6, 6, 3, 1]) await userEvent.click(screen.getByTestId(`pad-${v}`));
    expect(screen.getByTestId('confirm-roll')).toBeDisabled();
    await userEvent.click(screen.getByTestId('pad-2'));
    await userEvent.click(screen.getByTestId('confirm-roll'));
    expect(onConfirm).toHaveBeenCalledWith([6, 6, 3, 1, 2], [false, false, false, false, false]);
  });

  it('erlaubt Korrektur eines Entwurfs per Tastatur', async () => {
    const onConfirm = setup([]);
    await userEvent.click(screen.getByTestId('pad-1'));
    await userEvent.keyboard('2345{Backspace}6{Enter}');
    expect(onConfirm).toHaveBeenCalledWith([1, 2, 3, 4, 6], expect.any(Array));
  });

  it('gehaltene Würfel bleiben beim nächsten Wurf erhalten', async () => {
    const onConfirm = setup([roll(1, [6, 6, 2, 3, 4])]);
    expect(screen.getByTestId('roll-state')).toHaveTextContent('Bestätigt · Wurf 1 von 3');
    await userEvent.click(screen.getByTestId('die-0'));
    await userEvent.click(screen.getByTestId('die-1'));
    await userEvent.click(screen.getByTestId('reroll'));
    for (const v of [6, 5, 1]) await userEvent.click(screen.getByTestId(`pad-${v}`));
    await userEvent.click(screen.getByTestId('confirm-roll'));
    expect(onConfirm).toHaveBeenCalledWith([6, 6, 6, 5, 1], [true, true, false, false, false]);
  });

  it('nach dem dritten Wurf ist kein weiterer Wurf möglich', () => {
    setup([roll(1, [1, 2, 3, 4, 5]), roll(2, [1, 2, 3, 4, 6]), roll(3, [1, 2, 3, 4, 4])]);
    expect(screen.queryByTestId('reroll')).not.toBeInTheDocument();
    expect(screen.getByText('Alle 3 Würfe genutzt')).toBeInTheDocument();
  });

  it('zeigt Serverfehler an', async () => {
    setup([], vi.fn(async () => Promise.reject(new Error('Pro Zug sind höchstens drei Würfe erlaubt.'))));
    await userEvent.keyboard('{Tab}');
    for (const v of [1, 1, 1, 1, 1]) await userEvent.click(screen.getByTestId(`pad-${v}`));
    await userEvent.click(screen.getByTestId('confirm-roll'));
    expect(await screen.findByRole('alert')).toHaveTextContent('höchstens drei Würfe');
  });
});
