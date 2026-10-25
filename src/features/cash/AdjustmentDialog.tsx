import { useState } from 'react';
import type { LedgerEntry, Player } from '../../domain/types';
import { formatCents, formatSignedCents, parseEuroToCents } from '../../domain/money';
import { adjustmentInput } from '../../domain/validation';
import { formatDateTime } from '../../lib/format';
import { newIdempotencyKey } from '../../lib/storage';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';

interface Props {
  roomId: string;
  players: Player[];
  entries: LedgerEntry[];
  onClose: () => void;
  onSubmit: (playerId: string, amountCents: number, reason: string, correctsEntryId: string | null, key: string) => Promise<LedgerEntry>;
}

/** Korrekturbuchung: verändert keine bestehende Buchung, sondern bucht eine nachvollziehbare Gegenbuchung. */
export function AdjustmentDialog({ roomId, players, entries, onClose, onSubmit }: Props) {
  const [playerId, setPlayerId] = useState(players[0]?.id ?? '');
  const [direction, setDirection] = useState<'reduce' | 'increase'>('reduce');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [ref, setRef] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newIdempotencyKey);

  const cents = parseEuroToCents(amount);
  const signed = cents === null ? 0 : direction === 'reduce' ? -cents : cents;
  const parsed = adjustmentInput.safeParse({ roomId, playerId, amountCents: signed, reason, correctsEntryId: ref || null, idempotencyKey: key });
  const candidates = entries.filter((e) => e.playerId === playerId && e.type !== 'adjustment');

  const submit = async () => {
    if (!parsed.success || !confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(playerId, parsed.data.amountCents, parsed.data.reason, parsed.data.correctsEntryId ?? null, key);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title="Korrektur buchen"
      description="Bestehende Buchungen bleiben unverändert. Die Korrektur wird als eigener Eintrag mit Grund protokolliert."
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={submit} disabled={!parsed.success || !confirmed} loading={busy} loadingText="Wird gebucht …">
            Korrektur buchen
          </Button>
        </>
      }
    >
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field__label">Person</legend>
        <div className="segmented">
          {players.map((p) => (
            <label key={p.id}>
              <input type="radio" name="adj-player" checked={playerId === p.id} onChange={() => { setPlayerId(p.id); setRef(''); }} />
              <span>{p.displayName}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field__label">Art</legend>
        <div className="segmented">
          <label>
            <input type="radio" name="adj-dir" checked={direction === 'reduce'} onChange={() => setDirection('reduce')} />
            <span>Offenen Betrag verringern</span>
          </label>
          <label>
            <input type="radio" name="adj-dir" checked={direction === 'increase'} onChange={() => setDirection('increase')} />
            <span>Offenen Betrag erhöhen</span>
          </label>
        </div>
      </fieldset>
      <div className="field">
        <label className="field__label" htmlFor="adj-amount">
          Betrag in €
        </label>
        <input id="adj-amount" className="input input--money" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        {cents !== null && cents > 0 && <span className="field__hint">Buchung: {formatSignedCents(signed)}</span>}
      </div>
      <div className="field">
        <label className="field__label" htmlFor="adj-ref">
          Bezieht sich auf (optional)
        </label>
        <select id="adj-ref" className="select" value={ref} onChange={(e) => setRef(e.target.value)}>
          <option value="">– keine bestimmte Buchung –</option>
          {candidates.map((e) => (
            <option key={e.id} value={e.id}>
              {formatDateTime(e.createdAt)} · {e.description} ({formatCents(Math.abs(e.amountCents))})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field__label" htmlFor="adj-reason">
          Grund (Pflicht)
        </label>
        <textarea id="adj-reason" className="textarea" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <label className="check">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>Ich bestätige diese Korrekturbuchung. Sie kann nicht gelöscht, nur durch eine weitere Korrektur ausgeglichen werden.</span>
      </label>
      {error && (
        <div className="notice notice--danger" role="alert">
          {error}
        </div>
      )}
    </Dialog>
  );
}
