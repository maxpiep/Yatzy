import { useState } from 'react';
import { useSnapshot } from '../state/club';
import { EmptyState } from '../ui/EmptyState';
import { GameRow } from '../features/history/GameRow';

export function HistoryPage() {
  const snapshot = useSnapshot();
  const [showCancelled, setShowCancelled] = useState(false);
  const finished = snapshot.games.filter((g) => g.status === 'finished').sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''));
  const cancelled = snapshot.games.filter((g) => g.status === 'cancelled');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Spielhistorie</h1>
          <p>Jede abgeschlossene Partie bleibt dauerhaft gespeichert – mit Wertungsblock und Abrechnung.</p>
        </div>
      </div>
      <section className="panel panel--flush">
        {finished.length === 0 ? (
          <EmptyState title="Noch keine abgeschlossene Partie">Hier erscheinen eure Partien, sobald die erste abgeschlossen ist.</EmptyState>
        ) : (
          <ul className="game-list" aria-label="Abgeschlossene Partien">
            {finished.map((g) => (
              <GameRow key={g.id} game={g} />
            ))}
          </ul>
        )}
      </section>
      {cancelled.length > 0 && (
        <section className="panel panel--flush">
          <button type="button" className="btn btn--ghost btn--block" aria-expanded={showCancelled} onClick={() => setShowCancelled((v) => !v)}>
            {showCancelled ? 'Abgebrochene Partien ausblenden' : `Abgebrochene Partien anzeigen (${cancelled.length})`}
          </button>
          {showCancelled && (
            <ul className="game-list">
              {cancelled.map((g) => (
                <GameRow key={g.id} game={g} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
