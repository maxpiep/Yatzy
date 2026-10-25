import { useState } from 'react';
import type { LedgerEntry, Player } from '../../domain/types';
import { formatCents, parseEuroToCents } from '../../domain/money';
import { paymentInput } from '../../domain/validation';
import type { PlayerBalance } from '../../domain/ledger';
import { newIdempotencyKey } from '../../lib/storage';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';

interface Props {
  roomId: string;
  players: Player[];
  balances: Record<string, PlayerBalance>;
  onClose: () => void;
  onSubmit: (playerId: string, amountCents: number, note: string | null, key: string) => Promise<LedgerEntry>;
}

export function PaymentDialog({ roomId, players, balances, onClose, onSubmit }: Props) {
  const [playerId, setPlayerId] = useState(() => players.find((p) => (balances[p.id]?.openCents ?? 0) > 0)?.id ?? players[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newIdempotencyKey);

  const cents = parseEuroToCents(amount);
  const parsed = paymentInput.safeParse({ roomId, playerId, amountCents: cents ?? -1, note: note || undefined, idempotencyKey: key });
  const open = balances[playerId]?.openCents ?? 0;
  const over = cents !== null && cents > open ? cents - open : 0;
  const amountError = amount && cents === null ? 'Bitte einen Betrag wie 2 oder 2,50 eingeben.' : amount && !parsed.success ? parsed.error.issues[0]?.message : null;

  const submit = async () => {
    if (!parsed.success || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(playerId, parsed.data.amountCents, parsed.data.note ?? null, key);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title="Zahlung erfassen"
      description="Eine Zahlung reduziert den offenen Betrag. Sie wird erst nach Bestätigung durch den Server gebucht."
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={submit} disabled={!parsed.success} loading={busy} loadingText="Wird gebucht …" data-testid="confirm-payment">
            Zahlung buchen
          </Button>
        </>
      }
    >
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field__label">Wer zahlt?</legend>
        <div className="segmented">
          {players.map((p) => (
            <label key={p.id}>
              <input type="radio" name="payer" checked={playerId === p.id} onChange={() => setPlayerId(p.id)} />
              <span>
                {p.displayName} · offen {formatCents(balances[p.id]?.openCents ?? 0)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label className="field__label" htmlFor="pay-amount">
          Betrag in €
        </label>
        <input
          id="pay-amount"
          className="input input--money"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={Boolean(amountError)}
          aria-describedby="pay-amount-hint"
        />
        <span id="pay-amount-hint" className={amountError ? 'field__error' : 'field__hint'}>
          {amountError ?? 'Centgenau, z. B. 5 oder 2,50'}
        </span>
      </div>
      {over > 0 && (
        <div className="notice notice--warning" role="status">
          Die Zahlung übersteigt den offenen Betrag um {formatCents(over)}. Der Rest wird als Guthaben verbucht und mit künftigen Einsätzen verrechnet.
        </div>
      )}
      <div className="field">
        <label className="field__label" htmlFor="pay-note">
          Notiz (optional)
        </label>
        <input id="pay-note" className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. bar, PayPal" />
      </div>
      {error && (
        <div className="notice notice--danger" role="alert">
          {error}
        </div>
      )}
    </Dialog>
  );
}
