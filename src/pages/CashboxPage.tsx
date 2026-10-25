import { useMemo, useState } from 'react';
import type { LedgerEntryType } from '../domain/types';
import { filterLedger, LEDGER_TYPE_LABELS, summarizeLedger, type LedgerFilter } from '../domain/ledger';
import { formatCents } from '../domain/money';
import { useClub, useSnapshot } from '../state/club';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { PlayerName } from '../ui/PlayerChip';
import { IconPlus } from '../ui/Icons';
import { CountUp } from '../motion/CountUp';
import { LedgerTable } from '../features/cash/LedgerTable';
import { PaymentDialog } from '../features/cash/PaymentDialog';
import { AdjustmentDialog } from '../features/cash/AdjustmentDialog';

const euro = (v: number) => formatCents(Math.round(v));

export function CashboxPage() {
  const snapshot = useSnapshot();
  const { run, room } = useClub();
  const ids = snapshot.players.map((p) => p.id);
  const summary = useMemo(() => summarizeLedger(snapshot.ledger, ids), [snapshot.ledger, ids]);
  const [filter, setFilter] = useState<LedgerFilter>({ playerId: 'all', type: 'all' });
  const [dialog, setDialog] = useState<'payment' | 'adjustment' | null>(null);
  const filtered = filterLedger(snapshot.ledger, filter);
  const isOwner = room?.role === 'owner';

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Kniffelkasse</h1>
          <p>Jeder Vorgang ist eine eigene, unveränderliche Buchung. Offene Beträge werden daraus berechnet.</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
          <Button variant="primary" icon={<IconPlus />} onClick={() => setDialog('payment')} data-testid="open-payment">
            Zahlung erfassen
          </Button>
          {isOwner && <Button onClick={() => setDialog('adjustment')}>Korrektur buchen</Button>}
        </div>
      </div>

      <div className="grid-2">
        <section className="panel" aria-labelledby="open-h">
          <h2 id="open-h" style={{ marginBottom: 'var(--s-4)' }}>
            Offene Beträge
          </h2>
          <div className="balance-row">
            {snapshot.players.map((p) => {
              const b = summary.balances[p.id]!;
              return (
                <div className="balance" key={p.id}>
                  <PlayerName player={p} />
                  <CountUp className="balance__amount" value={b.openCents} format={euro} />
                  {b.creditCents > 0 && <span className="chip chip--success">Guthaben {formatCents(b.creditCents)}</span>}
                </div>
              );
            })}
          </div>
          <hr className="divider" />
          <p className="muted">
            Gesamt offen: <strong>{formatCents(summary.totalOpenCents)}</strong>
          </p>
        </section>
        <section className="panel" aria-labelledby="sum-h">
          <h2 id="sum-h" style={{ marginBottom: 'var(--s-4)' }}>
            Summen
          </h2>
          <div className="metrics">
            <div className="metric">
              <span className="metric__value">{formatCents(summary.totalStakesCents)}</span>
              <span className="metric__label">Einsätze</span>
            </div>
            <div className="metric">
              <span className="metric__value">{formatCents(summary.totalPaymentsCents)}</span>
              <span className="metric__label">Zahlungen</span>
            </div>
            <div className="metric">
              <span className="metric__value">{formatCents(summary.totalAdjustmentsCents)}</span>
              <span className="metric__label">Korrekturen (Saldo)</span>
            </div>
          </div>
        </section>
      </div>

      <section className="panel panel--flush" aria-labelledby="book-h">
        <div className="panel__head" style={{ padding: 'var(--s-5) var(--s-5) 0' }}>
          <h2 id="book-h">Kassenbuch</h2>
          <span className="subtle">
            {filtered.length} von {snapshot.ledger.length} Buchungen
          </span>
        </div>
        <div className="filters" role="group" aria-label="Kassenbuch filtern">
          <label className="field">
            <span className="field__label">Person</span>
            <select className="select" value={filter.playerId} onChange={(e) => setFilter((f) => ({ ...f, playerId: e.target.value }))}>
              <option value="all">Alle</option>
              {snapshot.players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Typ</span>
            <select className="select" value={filter.type} onChange={(e) => setFilter((f) => ({ ...f, type: e.target.value as LedgerEntryType | 'all' }))}>
              <option value="all">Alle</option>
              {(Object.keys(LEDGER_TYPE_LABELS) as LedgerEntryType[]).map((t) => (
                <option key={t} value={t}>
                  {LEDGER_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Von</span>
            <input type="date" className="input" value={filter.from ?? ''} onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value || undefined }))} />
          </label>
          <label className="field">
            <span className="field__label">Bis</span>
            <input type="date" className="input" value={filter.to ?? ''} onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value || undefined }))} />
          </label>
        </div>
        {snapshot.ledger.length === 0 ? (
          <EmptyState title="Die Kasse ist leer">Nach jeder verlorenen Partie wird hier der gewählte Einsatz automatisch gebucht.</EmptyState>
        ) : filtered.length === 0 ? (
          <p className="muted" style={{ padding: 'var(--s-5)' }}>
            Keine Buchungen für diesen Filter.
          </p>
        ) : (
          <LedgerTable entries={filtered} players={snapshot.players} />
        )}
      </section>

      {dialog === 'payment' && (
        <PaymentDialog
          roomId={snapshot.room.id}
          players={snapshot.players}
          balances={summary.balances}
          onClose={() => setDialog(null)}
          onSubmit={(playerId, amount, note, key) =>
            run((b) => b.recordPayment(snapshot.room.id, playerId, amount, note, key), { success: `Zahlung über ${formatCents(amount)} gebucht`, quiet: true })
          }
        />
      )}
      {dialog === 'adjustment' && (
        <AdjustmentDialog
          roomId={snapshot.room.id}
          players={snapshot.players}
          entries={snapshot.ledger}
          onClose={() => setDialog(null)}
          onSubmit={(playerId, amount, reason, ref, key) =>
            run((b) => b.recordAdjustment(snapshot.room.id, playerId, amount, reason, ref, key), { success: 'Korrektur gebucht', quiet: true })
          }
        />
      )}
    </div>
  );
}
