import { useRef, useState } from 'react';
import type { Game, StakeCents } from '../../domain/types';
import { formatCents, isValidStake } from '../../domain/money';
import { stakeSchema } from '../../domain/validation';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { IconInfo } from '../../ui/Icons';
import { StakeSelector } from './StakeSelector';
import { newIdempotencyKey } from '../../lib/storage';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Muss die Partie serverseitig erstellen und erst nach bestätigter Antwort auflösen. */
  onStart: (stakeCents: StakeCents, idempotencyKey: string) => Promise<Game>;
  onStarted: (game: Game) => void;
}

/**
 * Verpflichtender Einsatz-Dialog. Keine Vorauswahl; „Partie starten“ erst nach aktiver Auswahl.
 * Ein Idempotenzschlüssel pro Öffnen verhindert doppelte Partien bei Doppelklick oder Retry.
 */
export function StartGameModal({ open, onClose, onStart, onStarted }: Props) {
  if (!open) return null;
  return <StartGameModalContent onClose={onClose} onStart={onStart} onStarted={onStarted} />;
}

function StartGameModalContent({ onClose, onStart, onStarted }: Omit<Props, 'open'>) {
  const [stake, setStake] = useState<StakeCents | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(newIdempotencyKey);
  const inFlight = useRef(false);

  const submit = async () => {
    if (inFlight.current) return;
    const parsed = stakeSchema.safeParse(stake);
    if (!parsed.success || !isValidStake(stake)) {
      setError('Bitte wähle einen Einsatz: 1 €, 2 € oder 5 €.');
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const game = await onStart(parsed.data, idempotencyKey);
      onStarted(game);
    } catch (e) {
      setError((e as Error).message || 'Die Partie konnte nicht gestartet werden. Bitte erneut versuchen.');
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      title="Wie hoch ist der Einsatz für diese Partie?"
      description="Wähle genau einen Betrag. Er gilt nur für diese Partie und wird fest gespeichert."
      onClose={onClose}
      locked={submitting}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            size="lg"
            onClick={submit}
            disabled={stake === null}
            loading={submitting}
            loadingText="Partie wird erstellt …"
            data-testid="confirm-start"
          >
            Partie starten
          </Button>
        </>
      }
    >
      <StakeSelector value={stake} onChange={setStake} disabled={submitting} />
      <div className="notice notice--brass">
        <IconInfo />
        <span>
          Der ausgewählte Einsatz wird bei einer Niederlage fällig.
          {stake !== null && (
            <>
              {' '}
              <strong>Einsatz dieser Partie: {formatCents(stake)}</strong> – bei Unentschieden wird nichts berechnet.
            </>
          )}
        </span>
      </div>
      {error && (
        <div className="notice notice--danger" role="alert">
          {error}
        </div>
      )}
    </Dialog>
  );
}
