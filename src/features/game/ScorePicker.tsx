import { useState } from 'react';
import { CATEGORY_HINTS, CATEGORY_LABELS, type Category, type DieValue, type Scorecard } from '../../domain/types';
import type { Ruleset } from '../../domain/rules/ruleset';
import { extraKniffelAllowed, manualKind, manualOptions } from '../../domain/rules/manual';
import { reasonSchema } from '../../domain/validation';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { DiceFace } from '../../ui/DiceFace';

const FACE: Partial<Record<Category, DieValue>> = { ones: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6 };

export interface PickResult {
  points: number;
  extraKniffel: boolean;
  reason?: string;
}

interface Props {
  category: Category;
  playerName: string;
  ruleset: Ruleset;
  /** Scorecard-Kontext (für Zusatz-Kniffel: Kniffel-Feld mit 50 belegt?). */
  context: Scorecard;
  /** Vorbelegung bei Korrekturen. */
  initial?: PickResult;
  correction?: boolean;
  onClose: () => void;
  onSubmit: (result: PickResult) => Promise<void>;
}

/** Feld antippen → Wert wählen → bestätigen. Wie das Eintragen auf dem Papierblock. */
export function ScorePicker({ category, playerName, ruleset, context, initial, correction, onClose, onSubmit }: Props) {
  const kind = manualKind(category);
  const options = manualOptions(category, ruleset);
  const [points, setPoints] = useState<number | null>(initial?.points ?? null);
  const [extra, setExtra] = useState(initial?.extraKniffel ?? false);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const extraAllowed = extraKniffelAllowed(category, context, ruleset);
  const face = FACE[category];
  const reasonOk = !correction || reasonSchema.safeParse(reason).success;
  const canSubmit = points !== null && reasonOk && (!correction || confirmed) && !busy;

  const submit = async () => {
    if (!canSubmit || points === null) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ points, extraKniffel: extraAllowed && extra, reason: correction ? reason.trim() : undefined });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const summary = points === null ? null : points === 0 ? 'Feld streichen (0 Punkte)' : `${points} Punkte eintragen`;

  return (
    <Dialog
      open
      title={`${CATEGORY_LABELS[category]} · ${playerName}`}
      description={correction ? 'Wertung korrigieren – die Änderung wird mit Grund protokolliert.' : CATEGORY_HINTS[category]}
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button variant="primary" size="lg" onClick={submit} disabled={!canSubmit} loading={busy} loadingText="Speichert …" data-testid="confirm-pick">
            {summary ?? 'Wert wählen'}
          </Button>
        </>
      }
    >
      <div
        className={`picker picker--${kind}`}
        role="radiogroup"
        aria-label={kind === 'count' ? `Wie viele ${CATEGORY_LABELS[category]}?` : 'Punkte wählen'}
      >
        {kind === 'count' && <p className="picker__q">Wie viele {CATEGORY_LABELS[category]} liegen?</p>}
        {kind === 'sum' && <p className="picker__q">Summe aller fünf Würfel</p>}
        <div className="picker__grid">
          {options.map((o) => (
            <button
              key={o.points}
              type="button"
              role="radio"
              aria-checked={points === o.points}
              className={`picker__opt ${points === o.points ? 'picker__opt--on' : ''}`}
              onClick={() => setPoints(o.points)}
              data-testid={`opt-${o.points}`}
              aria-label={kind === 'count' ? `${o.count} ${CATEGORY_LABELS[category]}, ${o.points} Punkte` : `${o.points} Punkte`}
            >
              {kind === 'count' && face ? (
                <>
                  <span className="picker__count">{o.count}×</span>
                  <DiceFace value={face} size="sm" />
                  <span className="picker__pts">{o.points} Pkt.</span>
                </>
              ) : (
                <span className={kind === 'fixed' ? 'picker__big' : undefined}>{o.label}</span>
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          role="radio"
          aria-checked={points === 0}
          className={`picker__opt picker__opt--strike ${points === 0 ? 'picker__opt--on' : ''}`}
          onClick={() => setPoints(0)}
          data-testid="opt-0"
        >
          Streichen (0)
        </button>
      </div>

      {extraAllowed && (
        <label className="check notice notice--brass">
          <input type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} data-testid="extra-kniffel" />
          <span>
            <strong>Das war ein weiterer Kniffel</strong> – +{ruleset.extraKniffelBonus} Zusatzpunkte. Joker: jedes freie Feld darf mit seiner Höchstpunktzahl belegt werden.
          </span>
        </label>
      )}

      {correction && (
        <>
          <div className="field">
            <label className="field__label" htmlFor="pick-reason">
              Grund der Korrektur
            </label>
            <textarea id="pick-reason" className="textarea" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="z. B. falsch angetippt" />
          </div>
          <label className="check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>Ich bestätige diese Korrektur. Sie wird sichtbar protokolliert.</span>
          </label>
        </>
      )}

      {error && (
        <div className="notice notice--danger" role="alert">
          {error}
        </div>
      )}
    </Dialog>
  );
}
