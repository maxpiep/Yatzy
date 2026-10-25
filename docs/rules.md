# Kniffel-Regelwerk von Kniffel Club

Regelwerk-ID: `kniffel-schmidt`, Version `1`. Jede Partie speichert ID und Version als Snapshot
(`games.ruleset_id`, `games.ruleset_version`). Spätere Regeländerungen erhalten eine neue Version und
verändern keine laufenden oder historischen Partien.

Implementierung:

- Frontend/Vorschau: `src/domain/rules/scoring.ts`, `src/domain/rules/turn.ts`, Parameter in `src/domain/rules/ruleset.ts`
- Server (maßgeblich): `supabase/migrations/20261024120100_rules.sql` (`private.kc_evaluate`, `private.kc_totals`)
- Kreuztest: `tests/db/rules-parity.test.ts` vergleicht beide Implementierungen für **alle 7 776 Würfe ×
  alle Kategorien × Kniffel-Feld offen/gestrichen/belegt × Werten/Streichen**.

## Quelle

Grundlage ist die Spielanleitung von **Schmidt Spiele** (Kniffel, Art.-Nr. 49030 bzw. Classic Line 49203):

- https://www.schmidtspiele.de/files/Produkte/4/49030%20-%20Kniffel/49030_Kniffel_DE.pdf
- https://www.schmidtspiele.de/files/Produkte/4/49203%20-%20Kniffel%C2%AE/49203_Kniffel_DE.pdf

> Hinweis zur Verifikation: Die PDF-Dateien konnten aus der Entwicklungsumgebung nicht direkt geladen werden
> (Netzwerk-Policy). Die Regeln wurden anhand der in Suchergebnissen wiedergegebenen Wortlaute der
> Schmidt-Anleitung geprüft, u. a.: „Für jeden zweiten und weiteren Kniffel® trägst du dir 50 Zusatzpunkte auf
> der Rückseite des Blocks ein“ und „… in deiner Spalte bei einem beliebigen noch freien Kästchen die
> entsprechende Höchstpunktzahl eintragen. (Es ist dabei egal, mit welchem Würfelergebnis der Kniffel erzielt
> wurde.)“ mit dem Beispiel „mit einem 4er-Kniffel auch die Höchstpunktzahl 25 Punkte im 5er-Feld“.
> Bitte bei Gelegenheit mit der Anleitung eurer eigenen Spielausgabe abgleichen – Abweichungen lassen sich als
> neue Regelwerk-Version ergänzen.

## Ablauf

- 5 Würfel, 13 Felder je Spieler, Maxi und Franzi wechseln sich ab (26 Züge).
- Startspieler wechselt von Partie zu Partie (erste Partie: Maxi).
- Pro Zug höchstens **3 Würfe**. Nach jedem Wurf dürfen beliebige Würfel gehalten werden; gehaltene Würfel
  behalten ihren Wert, mindestens ein Würfel muss neu geworfen werden (serverseitig erzwungen).
- Nach jedem Zug muss genau ein freies Feld belegt werden – mit Punkten oder gestrichen (0).
- Die Würfel einer Wertung stammen immer aus dem zuletzt **bestätigten** Serverwurf, nicht aus dem Client.

## Eintragen (Direkteingabe)

Gewürfelt wird mit echten Würfeln, eingetragen wird nur der Wert – wie auf dem Papierblock:

| Feld | Mögliche Werte |
| --- | --- |
| Einser … Sechser | Anzahl 1–5 × Augenzahl (z. B. Dreier: 3, 6, 9, 12, 15) |
| Dreierpasch, Viererpasch, Chance | Summe aller Würfel 5–30 |
| Full House / Kleine Straße / Große Straße / Kniffel | 25 / 30 / 40 / 50 |
| jedes Feld | 0 = Streichen |

Ein **weiterer Kniffel** wird beim Eintragen über „Das war ein weiterer Kniffel“ markiert (nur möglich, wenn das
Kniffel-Feld bereits 50 Punkte hat): +50 Zusatzpunkte, Joker-Werte sind in den Optionen enthalten.
Implementierung: `src/domain/rules/manual.ts`, serverseitig `private.kc_manual_valid` und `public.score_manual` /
`public.correct_manual` (Migration `20261025120000_manual_scoring.sql`); ein Test prüft, dass TypeScript und SQL
exakt dieselben Werte erlauben. Die frühere würfelbasierte Wertung bleibt im Backend erhalten.

## Wertung

| Feld | Wertung |
| --- | --- |
| Einser … Sechser | Summe der jeweiligen Augenzahl |
| Bonus oben | +35, wenn die obere Summe **≥ 63** ist |
| Dreierpasch | Summe aller 5 Würfel bei mind. 3 gleichen, sonst 0 |
| Viererpasch | Summe aller 5 Würfel bei mind. 4 gleichen, sonst 0 |
| Full House | 25 bei 3 gleichen + 2 gleichen (zwei verschiedene Werte) |
| Kleine Straße | 30 bei 4 aufeinanderfolgenden Werten (1-2-3-4, 2-3-4-5, 3-4-5-6) |
| Große Straße | 40 bei 5 aufeinanderfolgenden Werten (1–5 oder 2–6) |
| Kniffel | 50 bei 5 gleichen |
| Chance | Summe aller 5 Würfel |

Endsumme = obere Summe + Bonus + untere Summe + Zusatzpunkte.

## Weitere Kniffel und Joker

Ein **weiterer Kniffel** liegt vor, wenn fünf gleiche Würfel fallen **und das Kniffel-Feld bereits mit 50
Punkten belegt ist**. Dann gilt:

1. **+50 Zusatzpunkte** (gespeichert an der Wertung des Zuges, `kniffel_bonus`, angezeigt als „Zusatzpunkte“).
2. **Joker:** Der Wurf darf in **jedes freie Feld** eingetragen werden und zählt dort dessen
   **Höchstpunktzahl** – unabhängig von der Augenzahl:

   | Feld | Höchstpunktzahl |
   | --- | --- |
   | Einser / Zweier / Dreier / Vierer / Fünfer / Sechser | 5 / 10 / 15 / 20 / 25 / 30 |
   | Dreierpasch / Viererpasch / Chance | 30 |
   | Full House / Kleine Straße / Große Straße | 25 / 30 / 40 |

   Beispiel: Fünf Vierer → Fünfer-Feld mit 25 Punkten (+50 Zusatzpunkte).
3. Joker-Punkte im oberen Block zählen für den 63er-Bonus.
4. Wer einen weiteren Kniffel trotzdem **streicht**, erhält 0 im Feld, behält aber die +50 Zusatzpunkte.

### Dokumentierte Annahmen (konfigurierbar in `ruleset.ts`)

- **Gestrichenes Kniffel-Feld:** Wurde das Kniffel-Feld gestrichen (0), ist ein späterer Kniffel kein „zweiter“
  Kniffel – es gibt keine Zusatzpunkte und keinen Joker; der Wurf wird normal gewertet
  (`extraKniffelRequiresScoredKniffel: true`).
- **Kniffel als Full House:** Ohne Joker zählt ein Kniffel nicht als Full House (`kniffelCountsAsFullHouse: false`).
- **Variante Meisterschaftsregel** (Joker nur im passenden Feld) ist nicht aktiv; sie ließe sich als eigene
  Regelwerk-Version ergänzen.

## Korrekturen

Gespeicherte Wertungen können nur während einer laufenden Partie über einen ausdrücklich bestätigten Dialog mit
Pflichtgrund korrigiert werden (`correct_score`). Die Neuberechnung nutzt das Kniffel-Feld zum Zeitpunkt der
ursprünglichen Wertung. Wird das **Kniffel-Feld** korrigiert (z. B. versehentlich gestrichen statt 50), werden alle
späteren Kniffel-Würfe dieses Spielers automatisch neu bewertet (Zusatzpunkte und Joker) und als „Folgekorrektur“
protokolliert; bewusst gestrichene Felder bleiben gestrichen (`strike_requested`). Alte und neue Werte werden in
`score_corrections` und `game_events` protokolliert, korrigierte Felder sind im Block markiert und die Anzahl der
Korrekturen wird im Abschlussdialog angezeigt. Abgeschlossene Partien sind unveränderlich.

Eine Partie, deren beide Blöcke vollständig sind, kann nicht mehr abgebrochen werden – sie muss abgeschlossen und
abgerechnet werden.
