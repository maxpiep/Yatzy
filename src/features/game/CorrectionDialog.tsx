import { useMemo, useState } from 'react';
import { CATEGORY_LABELS, type Category, type DieValue, type Game, type ScoreEntry, type Scorecard } from '../../domain/types';
import { getRuleset } from '../../domain/rules/ruleset';
import { calculateScore, strikeScore } from '../../domain/rules/scoring';
import { reasonSchema } from '../../domain/validation';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { DiceFace } from '../../ui/DiceFace';
import { IconAlert } from '../../ui/Icons';

interface Props {
  game: Game;
  playerName: string;
  category: Category;
  entry: ScoreEntry;
  scorecard: Scorecard;
  onClose: () => void;
  onSubmit: (dice: DieValue[], strike: boolean, reason: string) => Promise<void>;
}

/** Ausdrücklich bestätigte und protokollierte Korrektur einer gespeicherten Wertung. */
export function CorrectionDialog({ game, playerName, category, entry, scorecard, onClose, onSubmit }: Props) {
  const ruleset = getRuleset(game.rulesetId, game.rulesetVersion);
  const [dice, setDice] = useState<DieValue[]>([...entry.dice]);
  const [strike, setStrike] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => {
    // Gleicher Kontext wie auf dem Server: Kniffel-Feld zum Zeitpunkt der ursprünglichen Wertung.
    const context: Scorecard = {};
    if (category !== 'kniffel' && scorecard.kniffel && scorecard.kniffel.turnNo < entry.turnNo) context.kniffel = scorecard.kniffel;
    return strike ? strikeScore(dice, category, context, ruleset) : calculateScore(dice, category, context, ruleset);
  }, [dice, strike, category, scorecard, entry.turnNo, ruleset]);

  const reasonCheck = reasonSchema.safeParse(reason);
  const canSubmit = reasonCheck.success && confirmed && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(dice, strike, reason.trim());
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title={`${CATEGORY_LABELS[category]} korrigieren`}
      description={`Wertung von ${playerName}. Die Änderung wird mit Grund im Partieprotokoll gespeichert.`}
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit} loading={busy} loadingText="Speichert …">
            Korrektur speichern
          </Button>
        </>
      }
    >
      <div className="notice notice--warning">
        <IconAlert />
        <span>
          Bisher: <strong>{entry.kind === 'struck' ? 'gestrichen (0)' : `${entry.points} Punkte`}</strong>
          {entry.kniffelBonus > 0 && ` + ${entry.kniffelBonus} Zusatzpunkte`}. Neu:{' '}
          <strong>{preview.points === 0 ? 'gestrichen (0)' : `${preview.points} Punkte`}</strong>
          {preview.kniffelBonus > 0 && ` + ${preview.kniffelBonus} Zusatzpunkte`}
          {preview.joker && ' (Joker)'}.
        </span>
      </div>

      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field__label">Richtige Würfel</legend>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
          {dice.map((d, i) => (
            <label key={i} style={{ display: 'grid', justifyItems: 'center', gap: 6 }}>
              <DiceFace value={d} size="md" />
              <select
                className="select"
                value={d}
                aria-label={`Würfel ${i + 1}`}
                onChange={(e) => setDice((cur) => cur.map((v, j) => (j === i ? (Number(e.target.value) as DieValue) : v)))}
              >
                {[1, 2, 3, 4, 5, 6].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="check">
        <input type="checkbox" checked={strike} onChange={(e) => setStrike(e.target.checked)} />
        <span>Feld streichen (0 Punkte)</span>
      </label>

      <div className="field">
        <label className="field__label" htmlFor="correction-reason">
          Grund der Korrektur
        </label>
        <textarea
          id="correction-reason"
          className="textarea"
          value={reason}
          maxLength={300}
          onChange={(e) => setReason(e.target.value)}
          placeholder="z. B. Würfel falsch eingetippt"
          aria-invalid={reason.length > 0 && !reasonCheck.success}
        />
        {reason.length > 0 && !reasonCheck.success && <span className="field__error">{reasonCheck.error.issues[0]?.message}</span>}
      </div>

      <label className="check">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>Ich bestätige diese Korrektur. Sie wird für beide Spieler sichtbar protokolliert.</span>
      </label>

      {error && (
        <div className="notice notice--danger" role="alert">
          {error}
        </div>
      )}
    </Dialog>
  );
}
