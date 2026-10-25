import { useMemo } from 'react';
import { computeStatistics } from '../domain/statistics';
import { summarizeLedger } from '../domain/ledger';
import { formatCents } from '../domain/money';
import { formatDecimal, formatInt, formatPercent } from '../lib/format';
import { useSnapshot } from '../state/club';
import { EmptyState } from '../ui/EmptyState';
import { PlayerName, playerStyle } from '../ui/PlayerChip';
import { AnimatedContent } from '../motion/AnimatedContent';

export function LeaderboardPage() {
  const snapshot = useSnapshot();
  const ids = snapshot.players.map((p) => p.id);
  const stats = useMemo(() => computeStatistics(snapshot.games, ids), [snapshot.games, ids]);
  const ledger = useMemo(() => summarizeLedger(snapshot.ledger, ids), [snapshot.ledger, ids]);
  const players = snapshot.players;

  if (stats.played === 0) {
    return (
      <div className="page">
        <h1>Bestenliste</h1>
        <div className="panel">
          <EmptyState title="Noch keine Wertung">Die Bestenliste berechnet sich aus abgeschlossenen Partien – spielt eure erste.</EmptyState>
        </div>
      </div>
    );
  }

  type Row = { label: string; value: (id: string) => number | null; fmt: (v: number | null) => string; better?: 'high' | 'low' };
  const rows: Row[] = [
    { label: 'Siege', value: (id) => stats.players[id]!.wins, fmt: formatInt, better: 'high' },
    { label: 'Niederlagen', value: (id) => stats.players[id]!.losses, fmt: formatInt, better: 'low' },
    { label: 'Unentschieden', value: (id) => stats.players[id]!.draws, fmt: formatInt },
    { label: 'Siegquote', value: (id) => stats.players[id]!.winRate, fmt: formatPercent, better: 'high' },
    { label: 'Ø Punkte', value: (id) => stats.players[id]!.averageScore, fmt: formatDecimal, better: 'high' },
    { label: 'Höchste Punktzahl', value: (id) => stats.players[id]!.highScore, fmt: formatInt, better: 'high' },
    { label: 'Niedrigste Punktzahl', value: (id) => stats.players[id]!.lowScore, fmt: formatInt, better: 'high' },
    { label: 'Längste Siegesserie', value: (id) => stats.players[id]!.longestStreak, fmt: formatInt, better: 'high' },
    { label: 'Einsätze gesamt', value: (id) => ledger.balances[id]!.stakesCents, fmt: (v) => formatCents(v ?? 0), better: 'low' },
    { label: 'Zahlungen gesamt', value: (id) => ledger.balances[id]!.paymentsCents, fmt: (v) => formatCents(v ?? 0) },
    { label: 'Offen', value: (id) => ledger.balances[id]!.openCents, fmt: (v) => formatCents(v ?? 0), better: 'low' },
  ];

  const best = (row: Row) => {
    const vals = ids.map(row.value);
    if (!row.better || vals.some((v) => v === null) || vals[0] === vals[1]) return null;
    const pick = row.better === 'high' ? Math.max(...(vals as number[])) : Math.min(...(vals as number[]));
    return ids[vals.indexOf(pick)];
  };

  const streak = stats.currentStreak;
  const streakName = players.find((p) => p.id === streak?.playerId)?.displayName;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Bestenliste</h1>
          <p>Berechnet aus {stats.played} abgeschlossenen Partien. Abgebrochene Partien zählen nicht.</p>
        </div>
      </div>

      <AnimatedContent className="panel versus" aria-label="Direkter Vergleich">
        <div className="panel__head" style={{ marginBottom: 0 }}>
          <h2>Direkter Vergleich</h2>
          <span className="chip chip--felt">
            {streak ? `${streakName}: ${streak.length} ${streak.length === 1 ? 'Sieg' : 'Siege'} in Folge` : 'Keine laufende Serie'}
          </span>
        </div>
        <div className="versus__bar" role="img" aria-label={players.map((p) => `${p.displayName} ${stats.players[p.id]!.wins} Siege`).join(', ') + `, ${stats.draws} Unentschieden`}>
          {players[0] && <span style={{ width: `${(stats.players[players[0].id]!.wins / stats.played) * 100}%`, ...playerStyle(players[0].color) }} />}
          <span className="versus__draw" style={{ width: `${(stats.draws / stats.played) * 100}%` }} />
          {players[1] && <span style={{ width: `${(stats.players[players[1].id]!.wins / stats.played) * 100}%`, ...playerStyle(players[1].color) }} />}
        </div>
        <div className="versus__legend">
          {players[0] && (
            <span>
              <PlayerName player={players[0]} /> <strong>{stats.players[players[0].id]!.wins}</strong>
            </span>
          )}
          <span className="muted">{stats.draws} Unentschieden</span>
          {players[1] && (
            <span>
              <strong>{stats.players[players[1].id]!.wins}</strong> <PlayerName player={players[1]} />
            </span>
          )}
        </div>
        <div className="metrics" style={{ marginTop: 'var(--s-4)' }}>
          <div className="metric">
            <span className="metric__value">{stats.played}</span>
            <span className="metric__label">Partien gesamt</span>
          </div>
          <div className="metric">
            <span className="metric__value">{formatDecimal(stats.averageDifference)}</span>
            <span className="metric__label">Ø Punktedifferenz</span>
          </div>
          <div className="metric">
            <span className="metric__value">{formatCents(ledger.totalStakesCents)}</span>
            <span className="metric__label">Einsätze gesamt</span>
          </div>
          <div className="metric">
            <span className="metric__value">{formatCents(ledger.totalOpenCents)}</span>
            <span className="metric__label">Offen in der Kasse</span>
          </div>
        </div>
      </AnimatedContent>

      <section className="panel panel--flush" aria-labelledby="cmp-h">
        <h2 id="cmp-h" className="sr-only">
          Statistik im Vergleich
        </h2>
        <div className="table-wrap" data-lenis-prevent>
          <table className="table compare">
            <thead>
              <tr>
                <th scope="col">Kennzahl</th>
                {players.map((p) => (
                  <th scope="col" key={p.id} className="right">
                    {p.displayName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const winner = best(row);
                return (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    {ids.map((id) => (
                      <td key={id} className={winner === id ? 'best' : undefined}>
                        {row.fmt(row.value(id))}
                        {winner === id && <span className="sr-only"> (besser)</span>}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
