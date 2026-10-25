import { useEffect, useRef, useState } from 'react';
import { LocalBackend } from '../../data/localBackend';
import { toBackendError } from '../../data/errors';
import { useClub } from '../../state/club';
import { useToast } from '../../state/toast';
import { Button } from '../../ui/Button';

/** Datensicherung für den Ein-Gerät-Modus: Export als Datei, Import mit Bestätigung. */
export function BackupPanel() {
  const { backend } = useClub();
  const { notify } = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    navigator.storage?.persisted?.().then(
      (v) => alive && setPersisted(v),
      () => alive && setPersisted(null),
    );
    return () => {
      alive = false;
    };
  }, []);

  if (!(backend instanceof LocalBackend)) return null;

  const download = () => {
    const blob = new Blob([backend.exportData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kniffel-club-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Datensicherung heruntergeladen', 'success');
  };

  const restore = async (f: File) => {
    if (!window.confirm('Datensicherung wiederherstellen? Der aktuelle Stand auf diesem Gerät wird vollständig ersetzt.')) return;
    try {
      const res = backend.importData(await f.text());
      notify(`Wiederhergestellt: ${res.games} Partien, ${res.ledger} Kassenbuchungen`, 'success');
      // Neu starten, damit alle Ansichten den wiederhergestellten Stand laden – direkt auf der Übersicht.
      window.location.assign(import.meta.env.BASE_URL);
    } catch (e) {
      notify(toBackendError(e).message, 'error');
    }
  };

  return (
    <section className="panel">
      <h2>Datensicherung</h2>
      <p className="muted">
        Alle Partien, Wertungen und das Kassenbuch liegen nur in diesem Browser. Lade regelmäßig eine Sicherung herunter – damit lässt sich der Stand auch auf
        einem neuen Gerät wiederherstellen.
      </p>
      {persisted === false && (
        <div className="notice notice--warning">
          <span>Der Browser darf diese Daten bei Speicherknappheit löschen. Installiere die App auf dem Startbildschirm oder lege regelmäßig Sicherungen an.</span>
        </div>
      )}
      {persisted === true && <span className="chip chip--success">Speicher dauerhaft geschützt</span>}
      <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
        <Button variant="primary" onClick={download} data-testid="backup-export">
          Sicherung herunterladen
        </Button>
        <Button onClick={() => file.current?.click()}>Sicherung wiederherstellen …</Button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          data-testid="backup-import"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void restore(f);
          }}
        />
      </div>
    </section>
  );
}
