import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { CATEGORY_LABELS, type Category, type DieValue } from '../../domain/types';
import { deriveGameView, TOTAL_TURNS, TURNS_PER_PLAYER } from '../../domain/gameState';
import { getRuleset } from '../../domain/rules/ruleset';
import { isExtraKniffel, isKniffel, scoreOptions, type ScoreResult } from '../../domain/rules/scoring';
import { formatCents } from '../../domain/money';
import { useClub, useSnapshot } from '../../state/club';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { PlayerAvatar, playerStyle } from '../../ui/PlayerChip';
import { CountUp } from '../../motion/CountUp';
import { DiceInput } from './DiceInput';
import { Scorecard } from './Scorecard';
import { CorrectionDialog } from './CorrectionDialog';
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

  const [selection, setSelection] = useState<{ key: string; category: Category } | null>(null);
  const [editing, setEditing] = useState<{ playerId: string; category: Category } | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [scoring, setScoring] = useState(false);

  const turnKey = `${game.currentTurn}:${view.lastRoll?.id ?? 'none'}`;
  const selected = selection?.key === turnKey ? selection.category : null;
  const currentId = view.currentPlayerId;
  const currentName = game.players.find((p) => p.id === currentId)?.displayName ?? '';
  const currentCard = useMemo(() => (currentId ? (view.scorecards[currentId] ?? {}) : {}), [currentId, view.scorecards]);

  const previews = useMemo(() => {
    if (!view.lastRoll || !currentId) return undefined;
    const map: Partial<Record<Category, ScoreResult>> = {};
    for (const o of scoreOptions(view.lastRoll.dice, currentCard, ruleset)) map[o.category] = o;
    return map;
  }, [view.lastRoll, currentId, currentCard, ruleset]);

  const extraKniffel = view.lastRoll ? isExtraKniffel(view.lastRoll.dice, currentCard, ruleset) : false;
  const corrected = useMemo(() => new Set(scores.filter((s) => s.correctionCount > 0).map((s) => `${s.playerId}:${s.category}`)), [scores]);
  const selectedPreview = selected ? previews?.[selected] : undefined;

  const confirmRoll = async (dice: DieValue[], held: boolean[]) => {
    await run((b) => b.confirmRoll(game.id, game.version, game.currentTurn, dice, held), { quiet: true });
  };

  const commitScore = async (strike: boolean) => {
    if (!selected || scoring) return;
    setScoring(true);
    try {
      const pts = strike ? 0 : (selectedPreview?.points ?? 0);
      await run((b) => b.scoreTurn(game.id, game.version, game.currentTurn, selected, strike), {
        success: `${currentName}: ${CATEGORY_LABELS[selected]} ${pts === 0 ? 'gestrichen' : `mit ${pts} Punkten eingetragen`}`,
      });
      setSelection(null);
    } catch {
      // Meldung kommt als Toast; Stand wurde ggf. neu geladen.
    } finally {
      setScoring(false);
    }
  };

  const editEntry = editing ? view.scorecards[editing.playerId]?.[editing.category] : undefined;
  const turnInRound = Math.min(game.currentTurn, TOTAL_TURNS);

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

      <div className="game-layout">
        <aside className="game-layout__turn">
          {view.isComplete ? (
            <div className="panel turn-done">
              <h2>Beide Wertungsblöcke sind vollständig</h2>
              <p className="muted">Prüft noch einmal den Block. Mit dem Abschluss wird das Ergebnis dauerhaft gespeichert und die Kasse abgerechnet.</p>
              <Button variant="primary" size="lg" block onClick={() => setFinishing(true)} data-testid="open-finish">
                Partie abschließen
              </Button>
            </div>
          ) : (
            <div className="panel">
              <div className="turn__who" style={{ marginBottom: 'var(--s-3)' }}>
                <PlayerAvatar name={currentName} color={snapshot.players.find((x) => x.id === currentId)?.color} />
                <div>
                  <span className="eyebrow">Am Zug</span>
                  <br />
                  <strong data-testid="current-player">{currentName}</strong>
                </div>
              </div>
              <DiceInput key={`${game.id}:${game.currentTurn}:${view.rollsThisTurn.length}`} rolls={view.rollsThisTurn} maxRolls={ruleset.maxRollsPerTurn} disabled={scoring} onConfirm={confirmRoll} />
              {view.lastRoll && isKniffel(view.lastRoll.dice) && (
                <div className={`notice ${extraKniffel ? 'notice--brass' : 'notice--success'}`} role="status" style={{ marginTop: 'var(--s-4)' }}>
                  <span>
                    {extraKniffel ? (
                      <>
                        <strong>Weiterer Kniffel!</strong> +{ruleset.extraKniffelBonus} Zusatzpunkte. Joker: Jedes freie Feld zählt seine Höchstpunktzahl.
                      </>
                    ) : (
                      <>
                        <strong>Kniffel!</strong> Fünf gleiche Würfel.
                      </>
                    )}
                  </span>
                </div>
              )}
            </div>
          )}
          {room?.role === 'owner' && !view.isComplete && (
            <Button variant="ghost" size="sm" onClick={() => setCancelling(true)} style={{ justifySelf: 'start' }}>
              Partie abbrechen …
            </Button>
          )}
        </aside>

        <section className="game-layout__card" aria-label="Wertungsblock">
          <Scorecard
            game={game}
            players={snapshot.players}
            scorecards={view.scorecards}
            totals={view.totals}
            currentPlayerId={currentId}
            previews={previews}
            selected={selected}
            onSelect={(category) => setSelection({ key: turnKey, category })}
            onEdit={(playerId, category) => setEditing({ playerId, category })}
            corrected={corrected}
            caption={`Wertungsblock – ${game.players.map((p) => p.displayName).join(' gegen ')}`}
          />
          <p className="subtle" style={{ marginTop: 'var(--s-3)' }}>
            J = Joker-Wertung · +50 = Zusatzpunkte für weiteren Kniffel · Punkt = korrigiert. Gespeicherte Werte antippen, um sie zu korrigieren.
          </p>
        </section>
      </div>

      {selected && selectedPreview && !view.isComplete && (
        <div className="scorebar" role="region" aria-label="Wertung bestätigen">
          <div className="scorebar__line">
            <span>
              <span className="eyebrow" style={{ color: 'inherit', opacity: 0.7 }}>
                {currentName} · Entwurf
              </span>
              <br />
              <span className="scorebar__cat">{CATEGORY_LABELS[selected]}</span>
            </span>
            <span className="scorebar__pts" data-testid="selected-points">
              {selectedPreview.points} Pkt.
              {selectedPreview.kniffelBonus > 0 && <span style={{ fontSize: 'var(--fs-md)' }}> +{selectedPreview.kniffelBonus}</span>}
            </span>
          </div>
          <div className="scorebar__actions">
            <Button onClick={() => setSelection(null)} disabled={scoring}>
              Abbrechen
            </Button>
            {selectedPreview.points > 0 && (
              <Button onClick={() => commitScore(true)} disabled={scoring}>
                Stattdessen streichen
              </Button>
            )}
            <Button variant="primary" onClick={() => commitScore(false)} loading={scoring} loadingText="Speichert …" data-testid="confirm-score">
              {selectedPreview.points === 0 ? 'Feld streichen (0)' : 'Wertung eintragen'}
            </Button>
          </div>
        </div>
      )}

      {editing && editEntry && (
        <CorrectionDialog
          game={game}
          playerName={game.players.find((p) => p.id === editing.playerId)?.displayName ?? ''}
          category={editing.category}
          entry={editEntry}
          scorecard={view.scorecards[editing.playerId] ?? {}}
          onClose={() => setEditing(null)}
          onSubmit={async (dice, strike, reason) => {
            await run((b) => b.correctScore(game.id, game.version, editing.playerId, editing.category, dice, strike, reason), {
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
