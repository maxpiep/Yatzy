# Architektur

```
React-UI (src/pages, src/features, src/ui)
   │  nutzt
   ▼
State (src/state/club.tsx)  ── run(fn) → Speichern/Fehler/Toast/Neuladen
   │
   ▼
Backend-Interface (src/data/backend.ts)
   ├── ServerBackend    → eigener Server (server/): /api/rpc + Server-Sent Events (Mehrspieler, ohne Fremddienste)
   ├── SupabaseBackend  → PostgREST-RPCs + Selects, Supabase Realtime   (Mehrspieler, optional)
   └── LocalBackend     → Browser-Speicher, gleiche Semantik/Fehlercodes   (Einzelgerät, ausdrücklich gewählt)
   ▲
Domäne (src/domain) – reine Funktionen ohne React/Supabase:
   rules/ (Wertung, Joker, Würfe), gameState, ledger, statistics, money, validation (Zod)
```

## Eigener Server

`server/clubServer.ts` legt Zugriffsschutz (Geräte-Sitzungen, Einladungen, Rollen) um die Spiel-Engine
(`LocalBackend`), die dieselben Regeln, Validierungen und Fehlercodes wie die PostgreSQL-Funktionen umsetzt.
Node verarbeitet jede Anfrage vollständig synchron, bevor die nächste beginnt – jeder Vorgang ist atomar und wird
erst nach erfolgreicher Prüfung gespeichert (`server/fileStorage.ts`: temporäre Datei + fsync + rename). Nach jeder
Änderung erhalten die Geräte des Raums ein `change`-Ereignis und laden den Serverstand neu. Getestet in
`server/server.test.ts` und `e2e/server.spec.ts` (zwei getrennte Browser-Kontexte).

## Grundsätze

- **Quelle der Wahrheit ist PostgreSQL.** Das Frontend berechnet Wertungen nur als Vorschau. Der Server
  berechnet jede Wertung aus dem zuletzt gespeicherten Wurf neu; Clients senden nur Kategorie und Version.
- **Geschäftslogik nicht in Komponenten.** Komponenten rufen Domänenfunktionen und das Backend-Interface auf.
- **Geld in ganzen Cent.** Euro-Eingaben werden per Zeichenkette in Cent umgewandelt (`parseEuroToCents`).
- **Erfolg erst nach Serverantwort.** Toasts und Navigation (Partie starten, Zahlung, Abschluss) folgen erst
  auf eine bestätigte Antwort.

## Datenfluss einer Aktion

1. Komponente ruft `run(b => b.scoreTurn(gameId, version, turn, category, strike))`.
2. Server sperrt die Partie (`SELECT … FOR UPDATE`), prüft Mitgliedschaft, Status, `version` und Zug.
3. Bei Erfolg: neue Version; Realtime meldet die Änderung an alle Geräte.
4. Jeder Client lädt daraufhin den vollständigen Raum-Snapshot neu (`getRoomSnapshot`). Antworten werden über
   eine Sequenznummer verworfen, wenn bereits eine neuere Anfrage läuft.
5. Bei `stale_version`/`wrong_turn` wird der Serverstand geladen und eine verständliche Meldung angezeigt.

## Multiplayer

- Zugriff: Supabase **Anonymous Auth** (eine Identität pro Gerät) + Mitgliedschaft per Einladungslink.
- Einladungslink `https://<host>/beitreten#t=<token>`: Das Token steht im URL-Fragment (wird nicht an Server
  gesendet, landet nicht in Zugriffslogs) und wird sofort aus der Adresszeile entfernt. In der Datenbank liegt
  nur der SHA-256-Hash.
- Rollen: `owner` (Clubgründer bzw. per einmaligem Admin-Link) darf Einladungen erzeugen, Geräten den Zugriff
  entziehen, Partien abbrechen und Korrekturbuchungen vornehmen; `member` darf spielen, Wertungen korrigieren und
  Zahlungen erfassen.
- Vertrauensmodell: Maxi und Franzi sitzen am selben Tisch; jedes Mitglied darf für beide eintragen. Deshalb sind
  Wertungskorrekturen und Zahlungen nicht auf eine Person beschränkt, aber vollständig protokolliert und für beide
  sichtbar (Markierung im Block, Hinweis im Abschlussdialog, unveränderliches Kassenbuch).
- Verbindungsstatus: Kanalstatus von Supabase Realtime + `online`/`offline`-Events. Nach jeder
  (Wieder-)Verbindung und beim Zurückkehren in den Tab wird der Serverstand neu geladen.
- Konkurrierende Eingaben: optimistische Nebenläufigkeit über `games.version`; Entwürfe (noch nicht bestätigte
  Würfel) bleiben lokal und werden verworfen, sobald ein anderes Gerät den Zug fortsetzt.

## Transaktionsgrenzen

Jede RPC-Funktion ist genau eine Transaktion. Besonders kritisch:

- `create_game`: sperrt den Raum, prüft Idempotenzschlüssel und „eine aktive Partie“ (zusätzlich partieller
  Unique-Index). Ein Doppelklick sendet denselben Schlüssel → dieselbe Partie.
- `finish_game`: sperrt die Partie, berechnet beide Endstände serverseitig, bucht den Einsatz mit Schlüssel
  `game_loss:<id>` (zusätzlich Unique-Index „ein Einsatz pro Partie“) und schließt ab. Scheitert etwas, wird
  alles zurückgerollt (getestet in `tests/db/game-flow.test.ts`).

## Animationen

- GSAP über `@gsap/react` (`useGSAP` räumt Tweens beim Unmount automatisch auf).
- Eingesetzt für Seitenübergänge, Dialog-Einblendung, Würfel-Wurf, Hervorhebung neuer Punkte, Einsatz-Auswahl,
  Ergebnis-Zähler (`CountUp`), neue Kassenbuchungen und Toasts. Keine Animation blockiert Eingaben.
- `AnimatedContent` ist aus React Bits übernommen und angepasst (Lizenzhinweis in der Datei). Andere React-Bits-
  Komponenten wurden geprüft und nicht übernommen (z. B. `CountUp` benötigt zusätzlich `motion`).
- Lenis (sanftes Scrollen) nur bei feinem Zeiger und ohne reduzierte Bewegung; Dialoge, Tabellen, Selects und
  Textfelder sind ausgenommen; Touch bleibt nativ.
- `prefers-reduced-motion` und die Einstellung „Animationen: Reduziert“ schalten alle Animationen ab.
