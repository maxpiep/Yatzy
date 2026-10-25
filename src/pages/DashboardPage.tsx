import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { deriveGameView, TURNS_PER_PLAYER } from '../domain/gameState';
import { computeStatistics, finishedGames } from '../domain/statistics';
import { summarizeLedger } from '../domain/ledger';
import { formatCents } from '../domain/money';
import { useClub, useSnapshot } from '../state/club';
import { Button } from '../ui/Button';
import { DiceFace } from '../ui/DiceFace';
import { EmptyState } from '../ui/EmptyState';
import { PlayerName } from '../ui/PlayerChip';
import { IconArrowRight } from '../ui/Icons';
import { AnimatedContent } from '../motion/AnimatedContent';
import { CountUp } from '../motion/CountUp';
import { StartGameModal } from '../features/start/StartGameModal';
import { GameRow } from '../features/history/GameRow';

export function DashboardPage() {
  const snapshot = useSnapshot();
  const { run } = useClub();
  const navigate = useNavigate();
  const [startOpen, setStartOpen] = useState(false);
  const ids = snapshot.players.map((p) => p.id);
  const stats = useMemo(() => computeStatistics(snapshot.games, ids), [snapshot.games, ids]);
  const ledger = useMemo(() => summarizeLedger(snapshot.ledger, ids), [snapshot.ledger, ids]);
  const recent = finishedGames(snapshot.games).reverse().slice(0, 5);
  const active = snapshot.active;
  const view = active ? deriveGameView(active.game, active.scores, active.rolls) : null;
  const [maxi, franzi] = snapshot.players;

  let bilanz = 'Noch keine Partie entschieden';
  if (maxi && franzi && stats.played > 0) {
    const wm = stats.players[maxi.id]!.wins;
    const wf = stats.players[franzi.id]!.wins;
    bilanz = wm === wf ? `Ausgeglichen ${wm} : ${wf}` : `${wm > wf ? maxi.displayName : franzi.displayName} führt ${Math.max(wm, wf)} : ${Math.min(wm, wf)}`;
  }

  return (
    <div className="page">
      <AnimatedContent className="hero">
        <div className="hero__dice" aria-hidden="true">
          <DiceFace value={6} size="lg" />
          <DiceFace value={6} size="lg" />
          <DiceFace value={6} size="lg" />
        </div>
        <p className="eyebrow" style={{ color: 'inherit', opacity: 0.75 }}>
          {snapshot.room.name}
        </p>
        <h1>{active ? 'Die Würfel rollen.' : 'Bereit für die nächste Runde?'}</h1>
        {active && view ? (
          <div className="live-game" data-testid="live-game">
            <span className="eyebrow" style={{ color: 'inherit', opacity: 0.75 }}>
              Laufende Partie · Runde {view.round} von {TURNS_PER_PLAYER}
            </span>
            <div className="live-game__score num">
              {active.game.players.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && <span style={{ opacity: 0.5, marginRight: 12 }}>:</span>}
                  <span style={{ fontSize: 'var(--fs-md)', fontFamily: 'var(--font-sans)', marginRight: 8 }}>{p.displayName}</span>
                  {view.totals[p.id]?.total ?? 0}
                </span>
              ))}
            </div>
            <span>Einsatz dieser Partie: {formatCents(active.game.stakeCents)}</span>
            <div className="hero__actions">
              <Link className="btn btn--primary btn--lg" to={`/partie/${active.game.id}`}>
                Partie fortsetzen <IconArrowRight />
              </Link>
            </div>
          </div>
        ) : (
          <>
            <p>Echte Würfel, gemeinsamer Block: Wähle den Einsatz und legt los.</p>
            <div className="hero__actions">
              <Button variant="primary" size="lg" onClick={() => setStartOpen(true)} data-testid="open-start">
                Partie starten
              </Button>
            </div>
          </>
        )}
      </AnimatedContent>

      {stats.played === 0 && !active ? (
        <div className="panel">
          <EmptyState title="Noch keine Partien gespielt">
            Sobald ihr eure erste Partie abschließt, erscheinen hier Bilanz, Siege und die Kniffelkasse.
          </EmptyState>
        </div>
      ) : (
        <AnimatedContent className="grid-2" stagger={0.08}>
          <section className="panel" aria-labelledby="stats-h">
            <div className="panel__head">
              <h2 id="stats-h">Bilanz</h2>
              <span className="chip chip--felt">{bilanz}</span>
            </div>
            <div className="metrics">
              <div className="metric">
                <CountUp className="metric__value" value={stats.played} />
                <span className="metric__label">Partien</span>
              </div>
              {snapshot.players.map((p) => (
                <div className="metric" key={p.id}>
                  <CountUp className="metric__value" value={stats.players[p.id]?.wins ?? 0} />
                  <span className="metric__label">Siege {p.displayName}</span>
                </div>
              ))}
              <div className="metric">
                <CountUp className="metric__value" value={stats.draws} />
                <span className="metric__label">Unentschieden</span>
              </div>
            </div>
          </section>
          <section className="panel" aria-labelledby="cash-h">
            <div className="panel__head">
              <h2 id="cash-h">Offene Beträge</h2>
              <Link to="/kasse" className="subtle">
                Zur Kasse
              </Link>
            </div>
            <div className="balance-row">
              {snapshot.players.map((p) => {
                const b = ledger.balances[p.id];
                return (
                  <div className="balance" key={p.id}>
                    <PlayerName player={p} />
                    <span className="balance__amount" data-testid={`open-${p.slug}`}>
                      {formatCents(b?.openCents ?? 0)}
                    </span>
                    {b && b.creditCents > 0 && <span className="chip chip--success">Guthaben {formatCents(b.creditCents)}</span>}
                  </div>
                );
              })}
            </div>
          </section>
        </AnimatedContent>
      )}

      {recent.length > 0 && (
        <section className="panel panel--flush" aria-labelledby="recent-h">
          <div className="panel__head" style={{ padding: 'var(--s-5) var(--s-5) 0' }}>
            <h2 id="recent-h">Zuletzt gespielt</h2>
            <Link to="/historie" className="subtle">
              Alle Partien
            </Link>
          </div>
          <ul className="game-list">
            {recent.map((g) => (
              <GameRow key={g.id} game={g} />
            ))}
          </ul>
        </section>
      )}

      <StartGameModal
        open={startOpen}
        onClose={() => setStartOpen(false)}
        onStart={(stake, key) => run((b) => b.createGame(snapshot.room.id, stake, key), { quiet: true })}
        onStarted={(game) => {
          setStartOpen(false);
          navigate(`/partie/${game.id}`);
        }}
      />
    </div>
  );
}
