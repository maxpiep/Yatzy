import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import type { LedgerEntry, Player } from '../../domain/types';
import { LEDGER_TYPE_LABELS } from '../../domain/ledger';
import { formatSignedCents } from '../../domain/money';
import { formatDateTime } from '../../lib/format';
import { usePreferences } from '../../state/preferences';
import { PlayerName } from '../../ui/PlayerChip';

const TYPE_CHIP: Record<LedgerEntry['type'], string> = {
  game_loss: 'chip chip--danger',
  payment: 'chip chip--success',
  adjustment: 'chip chip--warning',
};

export function LedgerTable({ entries, players, showGameLink = true }: { entries: LedgerEntry[]; players: Player[]; showGameLink?: boolean }) {
  const body = useRef<HTMLTableSectionElement>(null);
  const seen = useRef<Set<string> | null>(null);
  const { reducedMotion } = usePreferences();

  useGSAP(
    () => {
      const ids = new Set(entries.map((e) => e.id));
      const previous = seen.current;
      seen.current = ids;
      if (!previous || reducedMotion || !body.current) return;
      const fresh = entries.filter((e) => !previous.has(e.id)).map((e) => body.current!.querySelector(`[data-entry="${e.id}"]`));
      const nodes = fresh.filter((n): n is Element => Boolean(n));
      if (nodes.length) gsap.fromTo(nodes, { backgroundColor: 'var(--c-brass-soft)' }, { backgroundColor: 'rgba(0,0,0,0)', duration: 1.4, clearProps: 'backgroundColor' });
    },
    { dependencies: [entries], scope: body },
  );

  const byId = new Map(entries.map((e) => [e.id, e]));
  return (
    <div className="table-wrap" data-lenis-prevent>
      <table className="table ledger">
        <caption className="sr-only">Kassenbuch</caption>
        <thead>
          <tr>
            <th scope="col">Datum</th>
            <th scope="col">Person</th>
            <th scope="col" className="col-hide-sm">
              Typ
            </th>
            <th scope="col">Beschreibung</th>
            <th scope="col" className="right">
              Betrag
            </th>
          </tr>
        </thead>
        <tbody ref={body}>
          {entries.map((e) => {
            const ref = e.correctsEntryId ? byId.get(e.correctsEntryId) : undefined;
            return (
              <tr key={e.id} data-entry={e.id}>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  {formatDateTime(e.createdAt)}
                </td>
                <td>
                  <PlayerName player={players.find((p) => p.id === e.playerId)} />
                </td>
                <td className="col-hide-sm">
                  <span className={`${TYPE_CHIP[e.type]} ledger-type`}>{LEDGER_TYPE_LABELS[e.type]}</span>
                </td>
                <td>
                  {e.description}
                  {showGameLink && e.gameId && (
                    <>
                      {' '}
                      · <Link to={`/historie/${e.gameId}`}>Partie ansehen</Link>
                    </>
                  )}
                  {e.correctsEntryId && (
                    <span className="subtle" style={{ display: 'block' }}>
                      korrigiert Buchung vom {ref ? formatDateTime(ref.createdAt) : 'früher'}
                    </span>
                  )}
                </td>
                <td className={`ledger-amount num ${e.amountCents > 0 ? 'amount--debit' : 'amount--credit'}`}>
                  {formatSignedCents(e.amountCents)}
                  <span className="sr-only">{e.amountCents > 0 ? ' Verbindlichkeit' : ' Entlastung'}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
