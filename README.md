# Kniffel Club

Premium-Kniffel für **Maxi & Franzi**: Beide würfeln mit echten Würfeln und tragen Würfe und Wertungen in
dieselbe Online-Partie ein – auf Smartphone, Tablet oder Desktop. Mit Echtzeit-Synchronisierung,
dauerhafter Spielhistorie, Bestenliste und einer nachvollziehbaren Kniffelkasse.

## Funktionen

- **Partie starten mit Pflicht-Einsatz:** „Partie starten“ öffnet einen Dialog mit 1 €, 2 € oder 5 € – ohne
  Vorauswahl. Erst nach aktiver Auswahl und Bestätigung wird die Partie serverseitig erstellt; der Einsatz wird
  als unveränderlicher Cent-Betrag in der Partie gespeichert. Doppelklicks erzeugen keine zweite Partie.
- **Würfeingabe für echte Würfel:** fünf Würfel mit Augen, Halten, bis zu drei Würfe, klare Trennung von Entwurf,
  bestätigtem Wurf und gespeicherter Wertung; Tastaturbedienung (1–6, Rücktaste, Enter).
- **Korrektes Regelwerk** (Schmidt Spiele) inkl. weiterer Kniffel (+50) und Joker – siehe [`docs/rules.md`](docs/rules.md).
- **Wertungsblock** mit Teilsumme, Bonus-Fortschritt, Summen, Zusatzpunkten, Joker- und Korrekturmarkierung.
- **Protokollierte Korrekturen** gespeicherter Wertungen (mit Grund und Bestätigung).
- **Atomarer Abschluss:** Endstand serverseitig neu berechnet, Verlierer genau einmal belastet, Unentschieden
  ohne Buchung.
- **Kniffelkasse:** unveränderliches Kassenbuch (Einsatz, Zahlung, Korrektur), offene Beträge und Guthaben,
  Filter nach Person, Typ und Zeitraum.
- **Spielhistorie** mit Detailansicht (Wertungsblock, Buchungen, Korrekturen, Ereignisprotokoll).
- **Bestenliste** aus abgeschlossenen Partien: Siege, Quote, Ø/Höchst-/Niedrigstpunkte, Serien, direkter Vergleich.
- **Multiplayer:** eigener Server oder Supabase, Einladungslink, Rollen, Verbindungsstatus.
- **Einstellungen:** Spielerprofile, Gerätezuordnung, Einladungen, Hell/Dunkel, reduzierte Animationen,
  sanftes Scrollen, Regelübersicht.
- Barrierefrei: semantisches HTML, Tastatur, sichtbarer Fokus, Screenreader-Texte, Dialoge mit Fokusfalle.

## Technologien

React 19 · TypeScript · Vite 8 · eigenes CSS-Design-System (Tokens in `src/styles/tokens.css`) ·
eigener Node-Server (Datei-Speicher, Server-Sent Events) oder optional Supabase (PostgreSQL, RLS, Realtime) · Zod · GSAP (`@gsap/react`) · Lenis ·
eine angepasste React-Bits-Komponente (`AnimatedContent`) · Vitest + Testing Library · Playwright.

## So wird gespielt: ein Gerät, echte Würfel

Ihr würfelt mit echten Würfeln am Tisch und tragt jeden Wurf auf **einem gemeinsamen Gerät** ein (Handy oder
Tablet, das weitergereicht wird). Die App ist ohne Server, Supabase oder Vercel nutzbar:

- **Online:** https://maxpiep.github.io/Yatzy/ – wird bei jedem Push auf `main` automatisch per GitHub Pages
  veröffentlicht. Tipp: „Zum Startbildschirm hinzufügen“, dann startet sie wie eine App.
- Alle Partien, die Bestenliste und die Kniffelkasse werden im Browser dieses Geräts gespeichert.
  **Unter Einstellungen → Datensicherung regelmäßig eine Sicherung herunterladen** – damit lässt sich der Stand
  auch auf einem neuen Gerät wiederherstellen.

Optional, falls ihr später doch zwei Handys synchron nutzen wollt: eigener Server (`docker compose up -d --build`)
oder Supabase – siehe [`docs/deployment.md`](docs/deployment.md).

## Installation & Entwicklung

```bash
npm install
cp .env.example .env.local      # Supabase-URL und anon-Key eintragen
npm run dev                     # http://localhost:5173
```

Ohne Supabase-Variablen bietet die App einen ausdrücklich gekennzeichneten **lokalen Modus** an (nur dieses
Gerät, keine Synchronisierung). Erzwingen: `VITE_BACKEND_MODE=local npm run dev`.

## Tests & Prüfungen

| Befehl | Inhalt |
| --- | --- |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm test` | Unit-/Komponententests (Regeln, Kasse, Statistik, Einsatz-Modal, Würfeingabe, lokales Backend) |
| `npm run test:db` | Datenbanktests gegen lokale PostgreSQL (Migrationen, RPCs, RLS, Nebenläufigkeit, Regel-Parität SQL↔TS) |
| `npm run test:e2e` | Playwright im lokalen Modus (komplette Partie, Abbruch, Kasse, zwei Tabs, mobile Breite) |
| `npm run test:e2e:server` | Playwright gegen den eigenen Server: zwei getrennte Geräte spielen dieselbe Partie in Echtzeit |
| `npm run build:selfhost` / `npm start` | Eigenen Server bauen und starten |
| `npm run build:pages` | Build für GitHub Pages (Ein-Gerät-Modus) |
| `npm run build` | Produktions-Build |
| `npm run check` | Lint + Typecheck + Unit-Tests + Build |

`test:db` benötigt PostgreSQL ≥ 14 lokal (`TEST_DATABASE_URL`, siehe `.env.example`) – niemals die
Produktionsdatenbank verwenden.

## Deployment

Siehe [`docs/deployment.md`](docs/deployment.md) (Supabase einrichten, Variablen, Vercel). Benötigte Variablen:
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Dokumentation

- [`docs/architecture.md`](docs/architecture.md) – Architektur, Datenfluss, Multiplayer, Transaktionen
- [`docs/database.md`](docs/database.md) – Tabellen, Funktionen, RLS, Migrationen
- [`docs/rules.md`](docs/rules.md) – Regelwerk, Joker, Quellen und Annahmen
- [`docs/deployment.md`](docs/deployment.md) – Einrichtung und Hosting
