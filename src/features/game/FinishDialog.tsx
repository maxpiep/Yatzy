import { useState } from 'react';
import type { Game, Player } from '../../domain/types';
import type { ScoreTotals } from '../../domain/rules/scoring';
import { determineOutcome } from '../../domain/gameState';
import { formatCents } from '../../domain/money';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { PlayerAvatar } from '../../ui/PlayerChip';
import { AnimatedContent } from '../../motion/AnimatedContent';
import { CountUp } from '../../motion/CountUp';

interface Props {
  game: Game;
  players: Player[];
  totals: Record<string, ScoreTotals>;
  onClose: () => void;
  onFinish: () => Promise<void>;
}

/** Abschlussdialog: zeigt das vorläufige Ergebnis; Abrechnung erst nach Serverbestätigung. */
export function FinishDialog({ game, players, totals, onClose, onFinish }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outcome = determineOutcome(totals);
  const name = (id: string | null) => game.players.find((p) => p.id === id)?.displayName ?? '';

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await onFinish();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      wide
      title="Partie abschließen"
      description="Beide Wertungsblöcke sind vollständig. Der Server prüft den Endstand und rechnet die Kniffelkasse genau einmal ab."
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Zurück zum Block
          </Button>
          <Button variant="primary" size="lg" onClick={finish} loading={busy} loadingText="Wird abgerechnet …" data-testid="confirm-finish">
            Abschließen & abrechnen
          </Button>
        </>
      }
    >
      <AnimatedContent className="result-grid" stagger={0.08}>
        {game.players.map((p) => {
          const color = players.find((x) => x.id === p.id)?.color;
          const won = outcome.winnerId === p.id;
          return (
            <div key={p.id} className={`result ${won ? 'result--win' : ''}`}>
              <PlayerAvatar name={p.displayName} color={color} size="lg" />
              <span className="result__name">{p.displayName}</span>
              <CountUp className="result__score" value={totals[p.id]?.total ?? 0} />
              <span className="result__tag">{outcome.isDraw ? 'Unentschieden' : won ? 'Sieg' : 'Niederlage'}</span>
            </div>
          );
        })}
      </AnimatedContent>
      <div className="notice notice--brass">
        <span>
          Einsatz dieser Partie: <strong>{formatCents(game.stakeCents)}</strong>.{' '}
          {outcome.isDraw ? 'Unentschieden – es wird kein Einsatz berechnet.' : `${name(outcome.loserId)} wird ${formatCents(game.stakeCents)} in der Kniffelkasse belastet.`}
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
