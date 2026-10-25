import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { GameDetail } from '../data/backend';
import { toBackendError } from '../data/errors';
import { deriveGameView } from '../domain/gameState';
import { CATEGORY_LABELS } from '../domain/types';
import { formatCents } from '../domain/money';
import { formatDateTime } from '../lib/format';
import { useClub, useSnapshot } from '../state/club';
import { EmptyState } from '../ui/EmptyState';
import { PlayerAvatar } from '../ui/PlayerChip';
import { Scorecard } from '../features/game/Scorecard';
import { LedgerTable } from '../features/cash/LedgerTable';
import { settlementText } from '../features/history/GameRow';
import { AnimatedContent } from '../motion/AnimatedContent';
import { CountUp } from '../motion/CountUp';

const EVENT_LABELS: Record<string, string> = {
  game_created: 'Partie erstellt',
  roll_confirmed: 'Wurf bestätigt',
  category_scored: 'Kategorie gewertet',
  score_corrected: 'Wertung korrigiert',
  game_finished: 'Partie abgeschlossen',
  cash_settled: 'Kasse abgerechnet',
  game_cancelled: 'Partie abgebrochen',
};

export function GameDetailPage() {
  const { gameId } = useParams();
  const [params] = useSearchParams();
  const justFinished = params.get('abgeschlossen') === '1';
  const { backend } = useClub();
  const snapshot = useSnapshot();
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Neu laden, wenn sich der Raum-Snapshot ändert (z. B. Abschluss auf anderem Gerät).
  useEffect(() => {
    if (!backend || !gameId) return;
    let alive = true;
    backend.getGameDetail(gameId).then(
      (d) => {
        if (!alive) return;
        setDetail(d);
        setError(null);
      },
      (e: unknown) => {
        if (alive) setError(toBackendError(e).message);
      },
    );
    return () => {
      alive = false;
    };
  }, [backend, gameId, snapshot]);

  const view = useMemo(() => (detail ? deriveGameView(detail.game, detail.scores, detail.rolls) : null), [detail]);

  if (error) return <EmptyState title="Partie nicht verfügbar">{error}</EmptyState>;
  if (!detail || !view) return <p className="muted">Lade Partie …</p>;
  const { game } = detail;
  const winner = game.players.find((p) => p.id === game.winnerPlayerId);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">
            <Link to="/historie">Historie</Link> / Partie
          </p>
          <h1>
            {game.status === 'finished' ? (game.isDraw ? 'Unentschieden' : `Sieg für ${winner?.displayName}`) : game.status === 'cancelled' ? 'Abgebrochene Partie' : 'Laufende Partie'}
          </h1>
          <p>
            Gestartet {formatDateTime(game.startedAt)}
            {game.finishedAt && ` · abgeschlossen ${formatDateTime(game.finishedAt)}`}
          </p>
        </div>
        <span className="chip chip--brass">Einsatz dieser Partie: {formatCents(game.stakeCents)}</span>
      </div>

      {game.status === 'finished' && game.finalScores && (
        <AnimatedContent className="panel" stagger={0}>
          {justFinished && (
            <p className="notice notice--success" role="status" style={{ marginBottom: 'var(--s-4)' }}>
              Partie gespeichert und Kasse abgerechnet.
            </p>
          )}
          <div className="result-grid">
            {game.players.map((p) => (
              <div key={p.id} className={`result ${p.id === game.winnerPlayerId ? 'result--win' : ''}`}>
                <PlayerAvatar name={p.displayName} color={snapshot.players.find((x) => x.id === p.id)?.color} size="lg" />
                <span className="result__name">{p.displayName}</span>
                <CountUp className="result__score" value={game.finalScores![p.id] ?? 0} duration={justFinished ? 1.2 : 0.6} />
                <span className="result__tag">{game.isDraw ? 'Unentschieden' : p.id === game.winnerPlayerId ? 'Sieg' : 'Niederlage'}</span>
              </div>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 'var(--s-4)' }}>
            Abrechnung: <strong>{settlementText(game)}</strong>
            {!game.isDraw && ` · Punktedifferenz ${Math.abs(Object.values(game.finalScores)[0]! - Object.values(game.finalScores)[1]!)}`}
          </p>
        </AnimatedContent>
      )}
      {game.status === 'cancelled' && <p className="notice notice--warning">Abgebrochen: {game.cancelReason}. Diese Partie zählt nicht zur Statistik; es wurde nichts gebucht.</p>}

      <Scorecard game={game} players={snapshot.players} scorecards={view.scorecards} totals={view.totals} caption="Vollständiger Wertungsblock" corrected={new Set(detail.scores.filter((s) => s.correctionCount > 0).map((s) => `${s.playerId}:${s.category}`))} />

      <section className="panel panel--flush" aria-labelledby="led-h">
        <div className="panel__head" style={{ padding: 'var(--s-5) var(--s-5) 0' }}>
          <h2 id="led-h">Kassenbuch dieser Partie</h2>
        </div>
        {detail.ledger.length === 0 ? (
          <p className="muted" style={{ padding: 'var(--s-5)' }}>
            Keine Buchung ({game.isDraw ? 'Unentschieden' : game.status === 'finished' ? '—' : 'noch nicht abgerechnet'}).
          </p>
        ) : (
          <LedgerTable entries={detail.ledger} players={snapshot.players} showGameLink={false} />
        )}
      </section>

      {detail.corrections.length > 0 && (
        <section className="panel" aria-labelledby="corr-h">
          <h2 id="corr-h" style={{ marginBottom: 'var(--s-3)' }}>
            Korrekturen
          </h2>
          <ul className="rules-list">
            {detail.corrections.map((c) => (
              <li key={c.id}>
                {formatDateTime(c.createdAt)} · {game.players.find((p) => p.id === c.playerId)?.displayName}, {CATEGORY_LABELS[c.category]}: {c.oldPoints} → {c.newPoints} Punkte – „{c.reason}“
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="panel">
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Partieprotokoll ({detail.events.length} Ereignisse)</summary>
        <ol className="rules-list" style={{ marginTop: 'var(--s-3)' }}>
          {detail.events.map((e) => (
            <li key={e.id}>
              {formatDateTime(e.createdAt)} · {EVENT_LABELS[e.type] ?? e.type}
              {typeof e.payload.category === 'string' && ` – ${CATEGORY_LABELS[e.payload.category as keyof typeof CATEGORY_LABELS] ?? e.payload.category}: ${String(e.payload.points)}`}
              {Array.isArray(e.payload.dice) && ` – Würfel ${(e.payload.dice as number[]).join(' ')}`}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
