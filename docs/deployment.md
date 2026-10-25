# Deployment

Status: **Noch nicht deployt.** In der Entwicklungsumgebung standen keine Zugangsdaten für Supabase oder Vercel
zur Verfügung. Alle Dateien sind vorbereitet; die folgenden Schritte sind noch durchzuführen.

## 1. Supabase-Projekt

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

## 2. Umgebungsvariablen

| Variable | Wert |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | anon public key |
| `VITE_BACKEND_MODE` | leer lassen (nur `local` für den Einzelgerät-Modus) |

Lokal: `.env.example` nach `.env.local` kopieren und ausfüllen.

## 3. Vercel

1. Repository in Vercel importieren (Framework „Vite“ wird erkannt; `vercel.json` ist vorhanden).
2. Die beiden `VITE_…`-Variablen für *Production* und *Preview* setzen.
3. Deploy. `vercel.json` leitet alle Unterseiten (z. B. `/kasse`, `/historie/<id>`, `/beitreten`) auf
   `index.html` um, setzt Sicherheits-Header und lange Cache-Zeiten für gehashte Assets.
4. Supabase → **Authentication → URL Configuration**: Site-URL auf die Vercel-Domain setzen.

## 4. Erste Einrichtung in der App

1. App öffnen → „Club gründen“. Es werden Maxi und Franzi angelegt.
2. Den **Einladungslink** an das zweite Gerät schicken, den **Admin-Link** sicher aufbewahren
   (stellt die Admin-Rolle auf einem neuen Gerät wieder her).
3. Neue Einladungslinks erzeugt der Admin unter Einstellungen → Einladen (alte werden ungültig).

## Prüfliste vor dem Go-live

- [ ] `npm run check` lokal grün (Lint, Typecheck, Unit-Tests, Build)
- [ ] `npm run test:db` gegen eine lokale PostgreSQL-Instanz grün
- [ ] Anonyme Anmeldung aktiviert, Migrationen ausgeführt, Realtime-Publication geprüft
- [ ] Zwei Geräte: Einladung, gemeinsamer Spielstand, Abschluss, Kassenbuchung geprüft
- [ ] Keine Testdaten in der Produktionsdatenbank (die App legt keine Beispieldaten an)
