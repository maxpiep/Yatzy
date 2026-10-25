import { useClub, type SyncState } from '../state/club';

const LABELS: Record<SyncState, { short: string; long?: string }> = {
  connecting: { short: 'Verbinde …' },
  synced: { short: 'Synchronisiert' },
  offline: { short: 'Offline', long: 'Verbindung unterbrochen' },
  saving: { short: 'Speichert …' },
  'save-failed': { short: 'Fehler', long: 'Speichern fehlgeschlagen' },
  local: { short: 'Lokal', long: 'Lokal – nur dieses Gerät' },
};

const CLASS: Record<SyncState, string> = {
  connecting: 'conn--connecting',
  synced: 'conn--synced',
  offline: 'conn--offline',
  saving: 'conn--saving',
  'save-failed': 'conn--error',
  local: 'conn--local',
};

export function ConnectionStatus() {
  const { syncState } = useClub();
  const label = LABELS[syncState];
  const full = label.long ?? label.short;
  return (
    <span className={`conn ${CLASS[syncState]}`} role="status" aria-live="polite" title={full}>
      <span className="conn__dot" aria-hidden="true" />
      {label.long ? (
        <>
          <span className="conn__label--long">{label.long}</span>
          <span className="conn__label--short">{label.short}</span>
        </>
      ) : (
        <span>{label.short}</span>
      )}
    </span>
  );
}
