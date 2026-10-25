import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { PreferencesProvider } from '../../state/preferences';
import type { Game, StakeCents } from '../../domain/types';
import { StartGameModal } from './StartGameModal';

const fakeGame = (stake: StakeCents) => ({ id: 'g1', stakeCents: stake }) as Game;

function Harness({ onStart, onStarted = () => {} }: { onStart: (s: StakeCents, k: string) => Promise<Game>; onStarted?: (g: Game) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <PreferencesProvider>
      <button onClick={() => setOpen(true)}>Partie starten</button>
      <StartGameModal
        open={open}
        onClose={() => setOpen(false)}
        onStart={onStart}
        onStarted={(g) => {
          onStarted(g);
          setOpen(false);
        }}
      />
    </PreferencesProvider>
  );
}

const confirmButton = () => screen.getByTestId('confirm-start');

describe('Partiestart mit Einsatz-Auswahl', () => {
  it('Klick auf „Partie starten“ öffnet das Modal mit der Pflichtfrage', async () => {
    render(<Harness onStart={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Partie starten' }));
    expect(screen.getByRole('dialog', { name: 'Wie hoch ist der Einsatz für diese Partie?' })).toBeInTheDocument();
    expect(screen.getByText(/Der ausgewählte Einsatz wird bei einer Niederlage fällig/)).toBeInTheDocument();
  });

  it('zeigt genau 1 €, 2 € und 5 € – ohne Vorauswahl – und die Bestätigung ist deaktiviert', async () => {
    render(<Harness onStart={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Partie starten' }));
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(['100', '200', '500']);
    expect(radios.every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(confirmButton()).toBeDisabled();
  });

  it('Abbrechen schließt das Modal und erstellt keine Partie', async () => {
    const onStart = vi.fn();
    render(<Harness onStart={onStart} />);
    await userEvent.click(screen.getByRole('button', { name: 'Partie starten' }));
    await userEvent.click(screen.getByTestId('stake-500'));
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();
  });

  it('Escape schließt ebenfalls ohne Partie', async () => {
    const onStart = vi.fn();
    render(<Harness onStart={onStart} />);
    await userEvent.click(screen.getByRole('button', { name: 'Partie starten' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();
  });

  it.each([
    ['stake-100', 100],
    ['stake-200', 200],
    ['stake-500', 500],
  ] as const)('Auswahl %s wird als %i Cent übergeben und erstellt genau eine Partie', async (testId, cents) => {
    const onStart = vi.fn(async (s: StakeCents) => fakeGame(s));
    const onStarted = vi.fn();
    render(<Harness onStart={onStart} onStarted={onStarted} />);
    await userEvent.click(screen.getByRole('button', { name: 'Partie starten' }));
    await userEvent.click(screen.getByTestId(testId));
    expect(confirmButton()).toBeEnabled();
    await userEvent.click(confirmButton());
    await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.calls[0]![0]).toBe(cents);
    expect(onStart.mock.calls[0]![1]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('Doppelklick löst nur eine Anfrage aus und zeigt einen Ladezustand', async () => {
    let resolve!: (g: Game) => void;
    const onStart = vi.fn(() => new Promise<Game>((r) => (resolve = r)));
    render(<Harness onStart={onStart} />);
    await userEvent.click(screen.getByRole('button', { name: 'Partie starten' }));
    await userEvent.click(screen.getByTestId('stake-200'));
    await userEvent.dblClick(confirmButton());
    await userEvent.click(confirmButton());
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(confirmButton()).toHaveAttribute('aria-busy', 'true');
    expect(confirmButton()).toHaveTextContent('Partie wird erstellt');
    resolve(fakeGame(200));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('bei einem Fehler bleibt das Modal offen, zeigt die Meldung und erlaubt einen erneuten Versuch mit gleichem Schlüssel', async () => {
    const onStart = vi
      .fn<(s: StakeCents, k: string) => Promise<Game>>()
      .mockRejectedValueOnce(new Error('Keine Verbindung zum Server.'))
      .mockResolvedValueOnce(fakeGame(100));
    render(<Harness onStart={onStart} />);
    await userEvent.click(screen.getByRole('button', { name: 'Partie starten' }));
    await userEvent.click(screen.getByTestId('stake-100'));
    await userEvent.click(confirmButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Keine Verbindung zum Server.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(confirmButton());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onStart.mock.calls[0]![1]).toBe(onStart.mock.calls[1]![1]);
  });

  it('jedes Öffnen erzeugt einen neuen Idempotenzschlüssel', async () => {
    const onStart = vi.fn(async (s: StakeCents) => fakeGame(s));
    render(<Harness onStart={onStart} />);
    for (let i = 0; i < 2; i++) {
      await userEvent.click(screen.getByRole('button', { name: 'Partie starten' }));
      await userEvent.click(screen.getByTestId('stake-200'));
      await userEvent.click(confirmButton());
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    }
    expect(onStart.mock.calls[0]![1]).not.toBe(onStart.mock.calls[1]![1]);
  });
});
