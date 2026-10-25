import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { CATEGORY_LABELS, type Category, type Scorecard as Card } from '../../domain/types';
import { deriveGameView, TOTAL_TURNS, TURNS_PER_PLAYER } from '../../domain/gameState';
import { getRuleset } from '../../domain/rules/ruleset';
import { formatCents } from '../../domain/money';
import { useClub, useSnapshot } from '../../state/club';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { PlayerAvatar, playerStyle } from '../../ui/PlayerChip';
import { CountUp } from '../../motion/CountUp';
import { Scorecard } from './Scorecard';
import { ScorePicker } from './ScorePicker';
import { FinishDialog } from './FinishDialog';
import { CancelGameDialog } from './CancelGameDialog';

export function GamePage() {
  const { gameId } = useParams();
  const snapshot = useSnapshot();
  const active = snapshot.active;

  if (!active || active.game.id !== gameId) {
    const known = snapshot.games.find((g) => g.id === gameId);
    if (known && known.status !== 'active') return <Navigate to={`/historie/${known.id}`} replace />;
    return (
      <EmptyState
        title="Keine laufende Partie"
        action={
          <Link className="btn btn--primary" to="/">
            Zur Übersicht
          </Link>
        }
      >
        Diese Partie läuft nicht (mehr). Starte auf der Übersicht eine neue Partie.
      </EmptyState>
    );
  }
  return <ActiveGame key={active.game.id} />;
}

function ActiveGame() {
  const snapshot = useSnapshot();
  const { run, room } = useClub();
  const navigate = useNavigate();
  const { game, rolls, scores } = snapshot.active!;
  const view = useMemo(() => deriveGameView(game, scores, rolls), [game, scores, rolls]);
  const ruleset = getRuleset(game.rulesetId, game.rulesetVersion);

  const [picking, setPicking] = useState<Category | null>(null);
  const [editing, setEditing] = useState<{ playerId: string; category: Category } | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const currentId = view.currentPlayerId;
  const currentName = game.players.find((p) => p.id === currentId)?.displayName ?? '';
  const currentCard = useMemo(() => (currentId ? (view.scorecards[currentId] ?? {}) : {}), [currentId, view.scorecards]);
  const corrected = useMemo(() => new Set(scores.filter((s) => s.correctionCount > 0).map((s) => `${s.playerId}:${s.category}`)), [scores]);
  const turnInRound = Math.min(game.currentTurn, TOTAL_TURNS);
  const nextName = game.currentTurn < TOTAL_TURNS ? game.players.find((p) => p.id !== currentId)?.displayName : null;

  const editEntry = editing ? view.scorecards[editing.playerId]?.[editing.category] : undefined;
  // Kontext für Zusatz-Kniffel bei Korrekturen: Kniffel-Feld zum Zeitpunkt der ursprünglichen Wertung.
  const editContext = useMemo<Card>(() => {
    if (!editing || !editEntry) return {};
    const k = view.scorecards[editing.playerId]?.kniffel;
    return editing.category !== 'kniffel' && k && k.turnNo < editEntry.turnNo ? { kniffel: k } : {};
  }, [editing, editEntry, view.scorecards]);

  return (
    <div className="page">
      <header className="game-head">
        <div>
          <p className="eyebrow">
            {view.isComplete ? 'Alle Felder belegt' : `Runde ${view.round} von ${TURNS_PER_PLAYER} · Zug ${turnInRound} von ${TOTAL_TURNS}`}
          </p>
          <h1 className="game-head__title">Laufende Partie</h1>
        </div>
        <span className="chip chip--brass" data-testid="game-stake">
          Einsatz dieser Partie: {formatCents(game.stakeCents)}
        </span>
      </header>

      <section className="duel" aria-label="Aktueller Spielstand">
        {game.players.map((p) => {
          const color = snapshot.players.find((x) => x.id === p.id)?.color;
          const isTurn = p.id === currentId;
          return (
            <div key={p.id} className={`duel__side ${isTurn ? 'duel__side--turn' : ''}`} style={playerStyle(color)}>
              <PlayerAvatar name={p.displayName} color={color} />
              <div className="duel__info">
                <span className="duel__name">{p.displayName}</span>
                <span className="duel__meta">
                  {isTurn ? 'ist am Zug' : `${view.totals[p.id]?.filled ?? 0} / ${TURNS_PER_PLAYER} Felder`}
                  {view.leaderId === p.id && ' · führt'}
                </span>
              </div>
              <CountUp className="duel__score" value={view.totals[p.id]?.total ?? 0} />
            </div>
          );
        })}
      </section>

      {view.isComplete ? (
        <div className="panel turn-done">
          <h2>Beide Wertungsblöcke sind vollständig</h2>
          <p className="muted">Prüft noch einmal den Block. Mit dem Abschluss wird das Ergebnis dauerhaft gespeichert und die Kasse abgerechnet.</p>
          <Button variant="primary" size="lg" block onClick={() => setFinishing(true)} data-testid="open-finish">
            Partie abschließen
          </Button>
        </div>
      ) : (
        <div className="turn-hint" role="status">
          <PlayerAvatar name={currentName} color={snapshot.players.find((x) => x.id === currentId)?.color} />
          <div>
            <strong data-testid="current-player">{currentName}</strong> ist am Zug
            <span className="subtle" style={{ display: 'block' }}>
              Würfeln, dann in der Spalte von {currentName} auf das passende Feld tippen.
            </span>
          </div>
        </div>
      )}

      <section aria-label="Wertungsblock">
        <Scorecard
          game={game}
          players={snapshot.players}
          scorecards={view.scorecards}
          totals={view.totals}
          currentPlayerId={currentId}
          onSelect={view.isComplete ? undefined : (category) => setPicking(category)}
          onEdit={(playerId, category) => setEditing({ playerId, category })}
          corrected={corrected}
          caption={`Wertungsblock – ${game.players.map((p) => p.displayName).join(' gegen ')}`}
        />
        <p className="subtle" style={{ marginTop: 'var(--s-3)' }}>
          + = Feld eintragen · J = Joker · +50 = Zusatzpunkte für weiteren Kniffel · Punkt = korrigiert. Eingetragene Werte antippen, um sie zu korrigieren.
        </p>
      </section>

      {room?.role === 'owner' && !view.isComplete && (
        <Button variant="ghost" onClick={() => setCancelling(true)} style={{ justifySelf: 'start' }}>
          Partie abbrechen …
        </Button>
      )}

      {picking && currentId && (
        <ScorePicker
          category={picking}
          playerName={currentName}
          ruleset={ruleset}
          context={currentCard}
          onClose={() => setPicking(null)}
          onSubmit={async ({ points, extraKniffel }) => {
            await run((b) => b.scoreManual(game.id, game.version, game.currentTurn, picking, points, extraKniffel), {
              success: `${currentName}: ${CATEGORY_LABELS[picking]} ${points === 0 ? 'gestrichen' : `mit ${points} Punkten eingetragen`}${nextName ? ` · Jetzt ist ${nextName} dran` : ''}`,
              quiet: true,
            });
          }}
        />
      )}

      {editing && editEntry && (
        <ScorePicker
          correction
          category={editing.category}
          playerName={game.players.find((p) => p.id === editing.playerId)?.displayName ?? ''}
          ruleset={ruleset}
          context={editContext}
          initial={{ points: editEntry.points, extraKniffel: editEntry.kniffelBonus > 0 }}
          onClose={() => setEditing(null)}
          onSubmit={async ({ points, extraKniffel, reason }) => {
            await run((b) => b.correctManual(game.id, game.version, editing.playerId, editing.category, points, extraKniffel, reason ?? ''), {
              success: 'Korrektur gespeichert und protokolliert',
              quiet: true,
            });
          }}
        />
      )}

      {finishing && (
        <FinishDialog
          game={game}
          players={snapshot.players}
          totals={view.totals}
          correctionCount={scores.filter((s) => s.correctionCount > 0).length}
          onClose={() => setFinishing(false)}
          onFinish={async () => {
            const finished = await run((b) => b.finishGame(game.id), { quiet: true });
            navigate(`/historie/${finished.id}?abgeschlossen=1`, { replace: true });
          }}
        />
      )}

      {cancelling && (
        <CancelGameDialog
          onClose={() => setCancelling(false)}
          onCancel={async (reason) => {
            await run((b) => b.cancelGame(game.id, reason), { success: 'Partie abgebrochen', quiet: true });
            navigate('/', { replace: true });
          }}
        />
      )}
    </div>
  );
}
