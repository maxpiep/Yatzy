import { useState } from 'react';
import { reasonSchema } from '../../domain/validation';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';

export function CancelGameDialog({ onClose, onCancel }: { onClose: () => void; onCancel: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = reasonSchema.safeParse(reason).success;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onCancel(reason.trim());
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title="Partie abbrechen?"
      description="Die Partie wird als abgebrochen markiert, zählt nicht für die Bestenliste und es wird kein Einsatz gebucht. Das lässt sich nicht rückgängig machen."
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Weiterspielen
          </Button>
          <Button variant="danger" onClick={submit} disabled={!valid} loading={busy}>
            Partie abbrechen
          </Button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor="cancel-reason">
          Grund
        </label>
        <textarea id="cancel-reason" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
      </div>
      {error && (
        <div className="notice notice--danger" role="alert">
          {error}
        </div>
      )}
    </Dialog>
  );
}
