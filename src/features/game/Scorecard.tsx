import type { ReactNode } from 'react';
import {
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  LOWER_CATEGORIES,
  UPPER_CATEGORIES,
  type Category,
  type Game,
  type Player,
  type ScoreEntry,
  type Scorecard as Card,
} from '../../domain/types';
import type { ScoreResult, ScoreTotals } from '../../domain/rules/scoring';
import { getRuleset } from '../../domain/rules/ruleset';
import { useFlash } from '../../motion/hooks';
import { playerStyle } from '../../ui/PlayerChip';

interface Props {
  game: Game;
  players: Player[];
  scorecards: Record<string, Card>;
  totals: Record<string, ScoreTotals>;
  currentPlayerId?: string | null;
  /** Mögliche Wertungen des aktuellen Wurfs für den Spieler am Zug. */
  previews?: Partial<Record<Category, ScoreResult>>;
  selected?: Category | null;
  onSelect?: (category: Category) => void;
  /** Öffnet die Korrektur einer gespeicherten Wertung. */
  onEdit?: (playerId: string, category: Category) => void;
  corrected?: ReadonlySet<string>;
  caption?: string;
}

function describeEntry(entry: ScoreEntry): string {
  if (entry.kind === 'struck') return 'gestrichen, 0 Punkte';
  const parts = [`${entry.points} Punkte`];
  if (entry.joker) parts.push('Joker');
  return parts.join(', ');
}

function ScoreCell({
  playerName,
  playerId,
  category,
  entry,
  preview,
  isCurrent,
  selected,
  onSelect,
  onEdit,
  corrected,
}: {
  playerName: string;
  playerId: string;
  category: Category;
  entry?: ScoreEntry;
  preview?: ScoreResult;
  isCurrent: boolean;
  selected: boolean;
  onSelect?: (c: Category) => void;
  onEdit?: (playerId: string, c: Category) => void;
  corrected: boolean;
}) {
  const flash = useFlash<HTMLTableCellElement>(entry ? `${entry.points}|${entry.kind}|${entry.kniffelBonus}` : 'open');
  const label = CATEGORY_LABELS[category];
  let content: ReactNode;

  if (entry) {
    const value = (
      <>
        <span className={entry.kind === 'struck' ? 'sc-value--struck' : undefined} aria-hidden="true">
          {entry.kind === 'struck' ? '0' : entry.points}
        </span>
        {entry.joker && (
          <span className="sc-flag" aria-hidden="true">
            J
          </span>
        )}
        {entry.kniffelBonus > 0 && (
          <span className="sc-flag sc-flag--bonus" aria-hidden="true">
            +{entry.kniffelBonus}
          </span>
        )}
        {corrected && <span className="sc-corrected" aria-hidden="true" />}
      </>
    );
    const desc = `${playerName}, ${label}: ${describeEntry(entry)}${entry.kniffelBonus ? `, ${entry.kniffelBonus} Zusatzpunkte` : ''}${corrected ? ', korrigiert' : ''}`;
    content = onEdit ? (
      <button type="button" className="sc-btn" onClick={() => onEdit(playerId, category)} aria-label={`${desc}. Wertung korrigieren`}>
        {value}
      </button>
    ) : (
      <span className="sc-btn" role="img" aria-label={desc}>
        {value}
      </span>
    );
  } else if (isCurrent && preview && onSelect) {
    const zero = preview.points === 0;
    content = (
      <button
        type="button"
        className={`sc-btn sc-preview ${zero ? 'sc-preview--zero' : ''} ${selected ? 'sc-preview--selected' : ''}`}
        onClick={() => onSelect(category)}
        aria-pressed={selected}
        aria-label={`${label} für ${preview.points} Punkte wählen${preview.joker ? ' (Joker)' : ''}${preview.kniffelBonus ? `, plus ${preview.kniffelBonus} Zusatzpunkte` : ''}`}
        data-testid={`pick-${category}`}
      >
        <span aria-hidden="true">{zero ? '–' : preview.points}</span>
        {preview.joker && (
          <span className="sc-flag" aria-hidden="true">
            J
          </span>
        )}
      </button>
    );
  } else {
    content = <span className="sr-only">offen</span>;
  }

  return (
    <td ref={flash} className={`sc-cell ${isCurrent ? 'sc-cell--current' : ''}`} data-testid={`cell-${playerId}-${category}`}>
      {content}
    </td>
  );
}

function SumCell({ value, children }: { value: number; children?: ReactNode }) {
  const flash = useFlash<HTMLTableCellElement>(value);
  return (
    <td ref={flash}>
      {value}
      {children}
    </td>
  );
}

/** Wertungsblock für beide Spieler mit Summen, Bonus und Zusatzpunkten. */
export function Scorecard({ game, players, scorecards, totals, currentPlayerId, previews, selected, onSelect, onEdit, corrected, caption }: Props) {
  const ruleset = getRuleset(game.rulesetId, game.rulesetVersion);
  const cols = game.players.map((snap) => ({
    id: snap.id,
    name: snap.displayName,
    color: players.find((p) => p.id === snap.id)?.color,
  }));

  const row = (category: Category) => (
    <tr key={category}>
      <th scope="row">
        <span className="sc-cat-name">{CATEGORY_LABELS[category]}</span>
        <span className="sc-cat-hint">{CATEGORY_HINTS[category]}</span>
      </th>
      {cols.map((c) => (
        <ScoreCell
          key={c.id}
          playerName={c.name}
          playerId={c.id}
          category={category}
          entry={scorecards[c.id]?.[category]}
          preview={c.id === currentPlayerId ? previews?.[category] : undefined}
          isCurrent={c.id === currentPlayerId}
          selected={c.id === currentPlayerId && selected === category}
          onSelect={onSelect}
          onEdit={onEdit}
          corrected={corrected?.has(`${c.id}:${category}`) ?? false}
        />
      ))}
    </tr>
  );

  return (
    <div className="panel panel--flush">
      <table className="scorecard">
        <caption className="sr-only">{caption ?? 'Wertungsblock'}</caption>
        <colgroup>
          <col className="sc-cat" />
          {cols.map((c) => (
            <col key={c.id} className="sc-player" />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: 'left', paddingLeft: 'var(--s-4)' }}>
              <span className="eyebrow">Kategorie</span>
            </th>
            {cols.map((c) => (
              <th key={c.id} scope="col" style={playerStyle(c.color)}>
                <span className="sc-head-player">
                  <span>{c.name}</span>
                  {c.id === currentPlayerId && <small>am Zug</small>}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="sc-section">
            <th colSpan={cols.length + 1} scope="colgroup">
              Oberer Block
            </th>
          </tr>
          {UPPER_CATEGORIES.map(row)}
          <tr className="sc-sum">
            <th scope="row">Summe oben</th>
            {cols.map((c) => (
              <SumCell key={c.id} value={totals[c.id]?.upperSubtotal ?? 0} />
            ))}
          </tr>
          <tr className="sc-sum">
            <th scope="row">
              Bonus <span className="subtle">(ab {ruleset.upperBonusThreshold} → +{ruleset.upperBonus})</span>
            </th>
            {cols.map((c) => {
              const t = totals[c.id];
              return (
                <SumCell key={c.id} value={t?.upperBonus ?? 0}>
                  <span className="sc-bonus-progress">
                    {t && t.upperBonus > 0 ? 'erreicht' : `noch ${t?.upperBonusMissing ?? ruleset.upperBonusThreshold}`}
                  </span>
                </SumCell>
              );
            })}
          </tr>
          <tr className="sc-sum sc-sum--strong">
            <th scope="row">Gesamt oben</th>
            {cols.map((c) => (
              <SumCell key={c.id} value={totals[c.id]?.upperTotal ?? 0} />
            ))}
          </tr>
          <tr className="sc-section">
            <th colSpan={cols.length + 1} scope="colgroup">
              Unterer Block
            </th>
          </tr>
          {LOWER_CATEGORIES.map(row)}
          <tr className="sc-sum sc-sum--strong">
            <th scope="row">Gesamt unten</th>
            {cols.map((c) => (
              <SumCell key={c.id} value={totals[c.id]?.lowerTotal ?? 0} />
            ))}
          </tr>
          <tr className="sc-sum">
            <th scope="row">
              Zusatzpunkte <span className="subtle">(weitere Kniffel)</span>
            </th>
            {cols.map((c) => (
              <SumCell key={c.id} value={totals[c.id]?.extraKniffelBonus ?? 0} />
            ))}
          </tr>
          <tr className="sc-total">
            <th scope="row" style={{ paddingLeft: 'var(--s-4)', fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)' }}>
              Endsumme
            </th>
            {cols.map((c) => (
              <SumCell key={c.id} value={totals[c.id]?.total ?? 0} />
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
