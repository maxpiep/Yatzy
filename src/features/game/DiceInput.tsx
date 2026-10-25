import { useRef, useState, type KeyboardEvent } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import type { DieValue, Roll } from '../../domain/types';
import { DiceFace, DIE_WORDS } from '../../ui/DiceFace';
import { Button } from '../../ui/Button';
import { IconLock, IconUndo } from '../../ui/Icons';
import { usePreferences } from '../../state/preferences';

type Slot = DieValue | null;

interface Props {
  /** Bestätigte Würfe des aktuellen Zuges (aufsteigend). */
  rolls: Roll[];
  maxRolls: number;
  disabled?: boolean;
  onConfirm: (dice: DieValue[], held: boolean[]) => Promise<void>;
}

const EMPTY: Slot[] = [null, null, null, null, null];
const NONE = [false, false, false, false, false];

/**
 * Eingabe für fünf physische Würfel. Unterscheidet klar zwischen
 * Entwurf (noch nicht gespeichert) und bestätigtem Wurf (auf dem Server gespeichert).
 * Gehaltene Würfel behalten ihren Wert beim nächsten Wurf.
 */
export function DiceInput({ rolls, maxRolls, disabled, onConfirm }: Props) {
  const last = rolls.at(-1) ?? null;
  const rollNo = last?.rollNo ?? 0;
  const canReroll = rollNo < maxRolls;
  const [mode, setMode] = useState<'entry' | 'view'>(last ? 'view' : 'entry');
  const [held, setHeld] = useState<boolean[]>(() => (last ? [...last.held] : [...NONE]));
  const [draft, setDraft] = useState<Slot[]>(EMPTY);
  const [active, setActive] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const row = useRef<HTMLDivElement>(null);
  const { reducedMotion } = usePreferences();

  useGSAP(
    () => {
      if (reducedMotion || !last || !row.current) return;
      gsap.from(row.current.querySelectorAll('[data-fresh="true"] .die'), {
        rotate: () => gsap.utils.random(-28, 28),
        y: -10,
        opacity: 0.2,
        duration: 0.45,
        ease: 'back.out(2)',
        stagger: 0.05,
      });
    },
    { scope: row, dependencies: [last?.id] },
  );

  const isEntry = mode === 'entry';
  const values: Slot[] = isEntry ? draft : last ? ([...last.dice] as Slot[]) : EMPTY;
  const complete = values.every((v) => v !== null);
  const nextRollNo = isEntry ? rollNo + 1 : rollNo;

  const startReroll = () => {
    if (!last) return;
    if (held.every(Boolean)) {
      setError('Mindestens ein Würfel muss neu geworfen werden. Hebe dazu eine Markierung auf.');
      return;
    }
    setError(null);
    setDraft(last.dice.map((d, i) => (held[i] ? d : null)) as Slot[]);
    setActive(held.findIndex((h) => !h));
    setMode('entry');
  };

  const cancelReroll = () => {
    setDraft(EMPTY);
    setActive(null);
    setError(null);
    setMode('view');
  };

  const isLocked = (i: number) => rollNo > 0 && Boolean(held[i]);
  const firstOpen = (slots: Slot[]) => slots.findIndex((v, i) => v === null && !isLocked(i));

  const setValue = (value: DieValue) => {
    if (!isEntry) return;
    const next = [...draft];
    const idx = active !== null && !isLocked(active) ? active : firstOpen(next);
    if (idx < 0) return;
    next[idx] = value;
    setDraft(next);
    const after = firstOpen(next);
    setActive(after >= 0 ? after : null);
  };

  const clearLast = () => {
    const next = [...draft];
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i] !== null && !isLocked(i)) {
        next[i] = null;
        setDraft(next);
        setActive(i);
        return;
      }
    }
  };

  const onSlot = (i: number) => {
    if (disabled || busy) return;
    if (isEntry) {
      if (isLocked(i)) return;
      setActive(i);
    } else if (canReroll) {
      setHeld((h) => h.map((v, j) => (j === i ? !v : v)));
      setError(null);
    }
  };

  const confirm = async () => {
    if (!complete || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(draft as DieValue[], rollNo === 0 ? [...NONE] : held);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isEntry || disabled || busy) return;
    if (/^[1-6]$/.test(e.key)) {
      e.preventDefault();
      setValue(Number(e.key) as DieValue);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      clearLast();
    } else if (e.key === 'Enter' && complete) {
      e.preventDefault();
      void confirm();
    }
  };

  const slotLabel = (i: number, v: Slot) => {
    const name = `Würfel ${i + 1}`;
    const val = v === null ? 'leer' : `${v} (${DIE_WORDS[v]})`;
    if (isEntry) return `${name}: ${val}${rollNo > 0 && held[i] ? ', gehalten' : ''}${active === i ? ', ausgewählt' : ''}`;
    return `${name}: ${val}${held[i] ? ', gehalten' : ''}${canReroll ? ' – antippen zum Halten' : ''}`;
  };

  return (
    <div className="turn" onKeyDown={onKeyDown}>
      <div className="turn__status">
        <span className={`state-badge ${isEntry ? 'state-badge--draft' : 'state-badge--confirmed'}`} data-testid="roll-state">
          {isEntry ? `Entwurf · Wurf ${nextRollNo}` : `Bestätigt · Wurf ${rollNo} von ${maxRolls}`}
        </span>
        <span className="rollmeter" aria-label={`${rollNo} von ${maxRolls} Würfen bestätigt`} role="img">
          {Array.from({ length: maxRolls }, (_, i) => (
            <span key={i} className={`rollmeter__pip ${i < rollNo ? 'rollmeter__pip--used' : ''}`} />
          ))}
        </span>
      </div>

      <div className="dice-row" ref={row} role="group" aria-label={isEntry ? 'Würfelwerte eintragen' : 'Bestätigter Wurf'}>
        {values.map((v, i) => {
          const isHeld = rollNo > 0 && held[i]!;
          return (
            <button
              key={i}
              type="button"
              className="die-slot"
              onClick={() => onSlot(i)}
              disabled={disabled || busy || (!isEntry && !canReroll)}
              aria-pressed={!isEntry && canReroll ? isHeld : undefined}
              aria-label={slotLabel(i, v)}
              data-fresh={!isEntry && !held[i] ? 'true' : 'false'}
              data-testid={`die-${i}`}
            >
              <DiceFace value={v} size="lg" held={isHeld} draft={isEntry && !isHeld} active={isEntry && active === i} />
              <span className="die-slot__tag" aria-hidden="true">
                {isHeld ? (
                  <>
                    <IconLock /> Gehalten
                  </>
                ) : (
                  ''
                )}
              </span>
            </button>
          );
        })}
      </div>

      {isEntry ? (
        <>
          <div className="dicepad" role="group" aria-label="Augenzahl wählen">
            {([1, 2, 3, 4, 5, 6] as DieValue[]).map((v) => (
              <button key={v} type="button" onClick={() => setValue(v)} disabled={disabled || busy || (complete && active === null)} aria-label={`Augenzahl ${v}`} data-testid={`pad-${v}`}>
                <DiceFace value={v} size="sm" />
                <span aria-hidden="true">{v}</span>
              </button>
            ))}
          </div>
          <div className="turn__actions">
            {rollNo > 0 ? (
              <Button variant="ghost" onClick={cancelReroll} disabled={busy}>
                Zurück zum Wurf {rollNo}
              </Button>
            ) : (
              <Button variant="ghost" icon={<IconUndo />} onClick={clearLast} disabled={busy || draft.every((d) => d === null)}>
                Korrigieren
              </Button>
            )}
            <Button variant="primary" onClick={confirm} disabled={!complete || disabled} loading={busy} loadingText="Speichert …" data-testid="confirm-roll">
              Wurf {nextRollNo} bestätigen
            </Button>
          </div>
          <p className="subtle">Tippe Würfel oder Zahlen an – auch per Tastatur 1–6, Rücktaste und Enter. Der Entwurf ist noch nicht gespeichert.</p>
        </>
      ) : (
        <>
          <div className="turn__actions">
            {canReroll ? (
              <Button onClick={startReroll} disabled={disabled} data-testid="reroll">
                Nochmal würfeln · Wurf {rollNo + 1}
              </Button>
            ) : (
              <span className="chip chip--warning">Alle {maxRolls} Würfe genutzt</span>
            )}
          </div>
          <p className="subtle">
            {canReroll ? 'Würfel antippen, um sie zu halten. ' : ''}
            Wähle unten im Wertungsblock ein Feld für diesen Wurf.
          </p>
        </>
      )}
      {error && (
        <div className="notice notice--danger" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
