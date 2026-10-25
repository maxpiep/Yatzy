import { Link } from 'react-router-dom';
import type { Game } from '../../domain/types';
import { formatCents } from '../../domain/money';
import { formatDateTime } from '../../lib/format';

export function settlementText(game: Game): string {
  if (game.status === 'cancelled') return 'Abgebrochen – keine Buchung';
  if (game.isDraw) return 'Unentschieden – keine Buchung';
  const loser = game.players.find((p) => p.id !== game.winnerPlayerId);
  return `${loser?.displayName ?? '?'} zahlt ${formatCents(game.stakeCents)}`;
}

export function GameRow({ game }: { game: Game }) {
  const [a, b] = game.players;
  const sa = a && game.finalScores ? game.finalScores[a.id] : undefined;
  const sb = b && game.finalScores ? game.finalScores[b.id] : undefined;
  const winner = game.players.find((p) => p.id === game.winnerPlayerId);
  const diff = sa !== undefined && sb !== undefined ? Math.abs(sa - sb) : null;
  return (
    <li>
      <Link to={`/historie/${game.id}`} aria-label={`Partie vom ${formatDateTime(game.finishedAt ?? game.startedAt)} – Details`}>
        <span>
          <strong>{a?.displayName}</strong> <span className="muted">gegen</span> <strong>{b?.displayName}</strong>
        </span>
        <span className="game-list__score num">
          {game.status === 'finished' ? `${sa} : ${sb}` : '—'}
        </span>
        <span className="game-list__meta">
          <span>{formatDateTime(game.finishedAt ?? game.startedAt)}</span>
          {game.status === 'finished' &&
            (game.isDraw ? <span className="chip">Unentschieden</span> : <span className="chip chip--brass">Sieg {winner?.displayName}</span>)}
          {diff !== null && game.status === 'finished' && !game.isDraw && <span>Differenz {diff}</span>}
          {game.status === 'cancelled' && <span className="chip chip--danger">Abgebrochen</span>}
          <span>Einsatz {formatCents(game.stakeCents)}</span>
          <span>· {settlementText(game)}</span>
        </span>
      </Link>
    </li>
  );
}
