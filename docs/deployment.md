# Deployment

Kniffel Club läuft **ohne Supabase und ohne Vercel**. Es gibt drei Betriebsarten:

| Betriebsart | Mehrere Geräte | Benötigt | Build |
| --- | --- | --- | --- |
| **Eigener Server** (empfohlen) | ja, Echtzeit | einen Rechner, der läuft (PC, Raspberry Pi, NAS, beliebiger Server) | `npm run build:selfhost` |
| **GitHub Pages** | nein (ein gemeinsames Gerät) | nichts außer dem GitHub-Repository | `npm run build:pages` (automatisch per Workflow) |
| Supabase + Vercel (optional) | ja, Echtzeit | Supabase- und Vercel-Konto | `npm run build` |

## A. Eigener Server (ohne Supabase/Vercel)

Der Server (`server/`) liefert die App aus, speichert alle Daten in **einer JSON-Datei** (atomar geschrieben,
Backup `*.bak` bei jedem Start) und synchronisiert alle Geräte per Server-Sent Events. Er nutzt dieselbe getestete
Spiel-Engine wie der lokale Modus (gleiche Regeln, Einsatzprüfung, Idempotenz, Versionsprüfung).

### Mit Docker

```bash
docker compose up -d --build        # http://<rechner>:8787
```

Die Daten liegen im Docker-Volume `kniffel-data` (`/data/kniffel-club.json`).

### Ohne Docker (Node ≥ 20.19)

```bash
npm ci
npm run build:selfhost
npm start                           # http://localhost:8787
```

Umgebungsvariablen (optional): `PORT` (8787), `HOST` (0.0.0.0), `DATA_FILE` (`data/kniffel-club.json`),
`STATIC_DIR` (`dist`).

### Zugriff von beiden Handys

- **Im selben WLAN:** `http://<IP-des-Rechners>:8787` öffnen.
- **Von unterwegs:** den Server hinter einen HTTPS-Reverse-Proxy (z. B. Caddy) oder einen Tunnel
  (z. B. Tailscale) stellen. Über das offene Internet bitte nur mit HTTPS betreiben, da Einladungslinks und
  Geräte-Sitzungen sonst mitgelesen werden könnten.

### Sicherheit

- Jedes Gerät erhält eine zufällige Sitzung (256 Bit); Zugriff auf einen Club nur über Einladungslink
  (192 Bit, nur als SHA-256-Hash gespeichert, 14 Tage gültig) bzw. einmaligen Admin-Link.
- Admin-Rechte (Einladungen, Geräte entfernen, Partie abbrechen, Korrekturbuchungen) nur für Owner.
- Neue Geräte-Sitzungen sind pro IP begrenzt (30 pro Stunde); Anfragen sind auf 64 KB begrenzt.
- Sicherheits-Header inkl. Content-Security-Policy; Echtzeit-Stream authentifiziert per Header (kein Token in URLs).
- **Backup:** die Datei `DATA_FILE` regelmäßig sichern.

## B. GitHub Pages (Ein-Gerät-Modus)

Der Workflow `.github/workflows/pages.yml` baut bei jedem Push auf `main` den Ein-Gerät-Modus und veröffentlicht
ihn unter `https://<benutzer>.github.io/Yatzy/`. Daten bleiben im Browser des Geräts (z. B. ein Tablet auf dem
Tisch); es gibt keine Synchronisierung zwischen Geräten.

Falls der erste Lauf mit einem Hinweis zu Pages scheitert: einmalig unter **Settings → Pages → Source**
„GitHub Actions“ wählen.

## C. Optional: Supabase + Vercel

### 1. Supabase-Projekt

1. Projekt auf https://supabase.com anlegen (Region EU, z. B. Frankfurt).
2. **Authentication → Sign In / Providers → „Allow anonymous sign-ins“ aktivieren.**
   (Optional: CAPTCHA/Turnstile für anonyme Anmeldungen aktivieren, um Missbrauch zu begrenzen.)
3. Migrationen ausführen – entweder per CLI:
   ```bash
   npm i -g supabase
   supabase login
   supabase init            # nur falls noch keine supabase/config.toml existiert – vorhandene Migrationen bleiben
   supabase link --project-ref <project-ref>
   supabase db push
   ```
   oder die vier Dateien aus `supabase/migrations/` der Reihe nach im **SQL Editor** ausführen.
4. **Database → Publications → `supabase_realtime`** prüfen: `games`, `game_rolls`, `game_scores`,
   `cash_ledger`, `players`, `rooms` müssen enthalten sein (die Migration fügt sie hinzu).
5. **Project Settings → API**: `Project URL` und den `anon public`-Key notieren.
   Den `service_role`-Key **niemals** im Frontend oder Repository verwenden.

### 2. Umgebungsvariablen

| Variable | Wert |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | anon public key |
| `VITE_BACKEND_MODE` | leer lassen (nur `local` für den Einzelgerät-Modus) |

Lokal: `.env.example` nach `.env.local` kopieren und ausfüllen.

### 3. Vercel

1. Repository in Vercel importieren (Framework „Vite“ wird erkannt; `vercel.json` ist vorhanden).
2. Die beiden `VITE_…`-Variablen für *Production* und *Preview* setzen.
3. Deploy. `vercel.json` leitet alle Unterseiten (z. B. `/kasse`, `/historie/<id>`, `/beitreten`) auf
   `index.html` um, setzt Sicherheits-Header und lange Cache-Zeiten für gehashte Assets.
4. Supabase → **Authentication → URL Configuration**: Site-URL auf die Vercel-Domain setzen.

## Erste Einrichtung in der App

1. App öffnen → „Club gründen“. Es werden Maxi und Franzi angelegt.
2. Den **Einladungslink** an das zweite Gerät schicken, den **Admin-Link** sicher aufbewahren
   (stellt die Admin-Rolle auf einem neuen Gerät wieder her).
3. Neue Einladungslinks erzeugt der Admin unter Einstellungen → Einladen (alte werden ungültig).

## Prüfliste

- [ ] `npm run check` lokal grün (Lint, Typecheck, Unit-Tests, Build)
- [ ] `npm run test:db` gegen eine lokale PostgreSQL-Instanz grün
- [ ] Anonyme Anmeldung aktiviert, Migrationen ausgeführt, Realtime-Publication geprüft
- [ ] Zwei Geräte: Einladung, gemeinsamer Spielstand, Abschluss, Kassenbuchung geprüft
- [ ] Keine Testdaten in der Produktionsdatenbank (die App legt keine Beispieldaten an)
