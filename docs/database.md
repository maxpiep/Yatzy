# Datenbank

PostgreSQL (Supabase). Migrationen liegen versioniert in `supabase/migrations/` und werden in
Dateinamen-Reihenfolge ausgeführt:

| Datei | Inhalt |
| --- | --- |
| `20261024120000_schema.sql` | Tabellen, Constraints, Indizes, Integritäts-Trigger |
| `20261024120100_rules.sql` | Serverseitiges Regelwerk (`private.kc_*`) |
| `20261024120200_rpc.sql` | Atomare Funktionen für alle Schreibvorgänge |
| `20261024120300_security.sql` | RLS, Rechte, Realtime-Publication |

## Tabellen

| Tabelle | Zweck | Wichtige Regeln |
| --- | --- | --- |
| `rooms` | Club (Spielraum) | – |
| `room_members` | Mitgliedschaft `auth.uid()` ↔ Raum, Rolle `owner`/`member` | PK (room_id, user_id) |
| `room_invites` | Einladungen; **nur SHA-256-Hash** des Tokens | Mitglieder-Link 14 Tage gültig, Admin-Link nur einmal verwendbar, widerrufbar; kein Client-Lesezugriff |
| `players` | Maxi & Franzi je Raum | `unique(room_id, slug)`, idempotent angelegt |
| `games` | Partie | `stake_amount_cents in (100,200,500)`, unveränderlich per Trigger; `version` für optimistische Nebenläufigkeit; max. eine aktive Partie je Raum (partieller Unique-Index); `unique(room_id, idempotency_key)`; Namens-Snapshot `players_snapshot`; Endstand `final_scores`/`final_breakdown` |
| `game_rolls` | Bestätigte Würfe | `unique(game_id, turn_no, roll_no)`, roll_no 1–3, unveränderlich |
| `game_scores` | Wertung je Partie/Spieler/Kategorie | `unique(game_id, player_id, category)`, `unique(game_id, turn_no)`; `kind` = `scored`/`struck` (0 Punkte; leer = keine Zeile), `strike_requested` = bewusst gestrichen; nur in aktiver Partie änderbar (Korrektur), nie löschbar |
| `score_corrections` | Protokoll jeder Korrektur (alt/neu/Grund) | unveränderlich |
| `game_events` | Ereignisprotokoll | unveränderlich |
| `cash_ledger` | Kassenbuch | Beträge in ganzen Cent, Vorzeichen: + Verbindlichkeit, − Entlastung; `unique(room_id, idempotency_key)`; **max. ein `game_loss` je Partie** (partieller Unique-Index); unveränderlich (Update/Delete per Trigger verboten) |

Alle Fremdschlüssel innerhalb eines Raums sind zusammengesetzt (`room_id, id`), damit keine Zeile auf Daten
eines fremden Raums zeigen kann.

## Funktionen (RPC)

Alle als `SECURITY DEFINER` mit `set search_path = ''`, ausführbar nur für die Rolle `authenticated`.

| Funktion | Zweck |
| --- | --- |
| `create_room(name, maxi, franzi)` | Club anlegen, Spieler idempotent erzeugen, Einladung + Admin-Link zurückgeben (einmalig im Klartext) |
| `join_room(token)` | Einladung prüfen (Hash, Ablauf, Widerruf) und Mitgliedschaft anlegen |
| `rotate_invite(room, role)` | Nur Owner: alte Links widerrufen, neuen erzeugen |
| `update_room`, `update_player` | Name/Farbe (wirkt nicht auf historische Partien – Snapshot) |
| `create_game(room, stake_cents, idempotency_key)` | Einsatz validieren (100/200/500), Raum sperren, idempotent, eine aktive Partie |
| `confirm_roll(game, expected_version, turn, dice, held)` | Wurf 1–3 validieren (gehaltene Würfel unverändert) |
| `score_turn(game, expected_version, turn, category, strike)` | Wertung aus dem letzten Serverwurf berechnen, Zug weiter |
| `correct_score(...)` | Protokollierte Korrektur mit Grund |
| `finish_game(game)` | **Atomar**: sperren, Vollständigkeit prüfen, Endstand neu berechnen, Sieger, `game_loss` mit gespeichertem Einsatz und Idempotenzschlüssel `game_loss:<id>`, Status abgeschlossen. Wiederholter/gleichzeitiger Aufruf gibt das bestehende Ergebnis zurück |
| `cancel_game(game, reason)` | Nur Owner: Partie abbrechen, keine Buchung, zählt nicht in Statistik; **nicht mehr möglich, sobald beide Blöcke vollständig sind** |
| `remove_member(room, user)` | Nur Owner: einem Gerät den Zugriff entziehen |
| `record_payment(room, player, cents, note, key)` | Zahlung (idempotent); Überzahlung wird als Guthaben (negativer Saldo) sichtbar |
| `record_adjustment(room, player, cents, reason, corrects, key)` | Nur Owner: Korrekturbuchung mit Pflichtgrund und optionaler Referenz |

Fehler werden als `kc_error:<code>` gemeldet und im Frontend übersetzt (`src/data/errors.ts`).

## Sicherheit / RLS

- RLS ist auf allen Tabellen aktiv. Einzige Policies: `SELECT` für Mitglieder des Raums (`private.is_member`).
- Für `anon`/`authenticated` sind `INSERT/UPDATE/DELETE` entzogen; geschrieben wird nur über die Funktionen.
- Interne Funktionen liegen im nicht exponierten Schema `private` und sind nicht direkt aufrufbar.
- Neue Funktionen sind standardmäßig für niemanden ausführbar (Default-Privileges entzogen); jede RPC wird einzeln freigegeben.
- Trigger verhindern Änderungen an Einsatz, abgeschlossenen Partien, Würfen, Protokollen und dem Kassenbuch –
  auch für Datenbank-Admins.
- Realtime: `games`, `game_rolls`, `game_scores`, `cash_ledger`, `players`, `rooms` sind in der Publication
  `supabase_realtime`; Supabase wertet die Select-Policies je Abonnent aus.

## Einrichtung

Siehe `docs/deployment.md`. Kurzfassung mit Supabase CLI:

```bash
supabase link --project-ref <ref>
supabase db push        # führt supabase/migrations/* aus
```

Alternativ den Inhalt der vier Dateien der Reihe nach im SQL-Editor des Dashboards ausführen.

## Tests

`npm run test:db` erstellt je Testdatei eine frische Datenbank auf einer lokalen PostgreSQL-Instanz
(`TEST_DATABASE_URL`, Standard `postgres://postgres:postgres@localhost:5432/postgres`), bildet die
Supabase-Rollen und `auth.uid()` nach (`tests/db/supabase-stub.sql`) und spielt alle Migrationen ein.
Getestet werden u. a. Einsatzvalidierung, Idempotenz, gleichzeitige Abschlüsse, Rollback, RLS und Rechte.
**Nie gegen eine Produktionsdatenbank ausführen.**
