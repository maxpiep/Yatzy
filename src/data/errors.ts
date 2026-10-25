/** Verständliche Fehlermeldungen statt technischer Codes. */
export const ERROR_MESSAGES: Record<string, string> = {
  not_configured: 'Das Backend ist nicht eingerichtet. Bitte Supabase-Zugangsdaten hinterlegen (siehe docs/deployment.md).',
  not_authenticated: 'Du bist nicht angemeldet. Bitte lade die Seite neu.',
  anonymous_disabled: 'Die anonyme Anmeldung ist im Supabase-Projekt deaktiviert. Bitte unter Authentication → Providers aktivieren.',
  database_not_ready: 'Die Datenbank ist noch nicht eingerichtet. Bitte die Migrationen ausführen (siehe docs/database.md).',
  forbidden: 'Du hast keinen Zugriff auf diesen Club. Bitte über einen gültigen Einladungslink beitreten.',
  owner_required: 'Diese Aktion ist nur für Club-Admins möglich.',
  invalid_invite: 'Dieser Einladungslink ist ungültig, abgelaufen oder wurde ersetzt.',
  invalid_stake: 'Bitte wähle einen gültigen Einsatz: 1 €, 2 € oder 5 €.',
  active_game_exists: 'Es läuft bereits eine Partie. Bitte zuerst die laufende Partie beenden.',
  idempotency_conflict: 'Diese Anfrage wurde bereits mit anderen Daten gesendet. Bitte erneut versuchen.',
  game_not_found: 'Diese Partie wurde nicht gefunden.',
  game_not_active: 'Diese Partie ist bereits abgeschlossen.',
  game_closed: 'Diese Partie ist abgeschlossen und kann nicht mehr verändert werden.',
  game_cancelled: 'Diese Partie wurde abgebrochen.',
  game_incomplete: 'Die Partie kann erst abgeschlossen werden, wenn beide Wertungsblöcke vollständig sind.',
  stale_version: 'Der Spielstand wurde inzwischen auf einem anderen Gerät geändert. Er wurde neu geladen – bitte prüfe die Eingabe.',
  wrong_turn: 'Dieser Zug ist nicht mehr aktuell. Der Spielstand wurde neu geladen.',
  invalid_dice: 'Bitte trage für alle fünf Würfel einen Wert von 1 bis 6 ein.',
  invalid_hold: 'Gehaltene Würfel müssen ihren Wert behalten und mindestens ein Würfel muss neu geworfen werden.',
  max_rolls_reached: 'Pro Zug sind höchstens drei Würfe erlaubt.',
  no_roll: 'Bitte zuerst einen Wurf bestätigen.',
  invalid_category: 'Unbekanntes Wertungsfeld.',
  category_taken: 'Dieses Feld ist bereits belegt.',
  score_not_found: 'Diese Wertung wurde nicht gefunden.',
  reason_required: 'Bitte gib einen Grund mit mindestens 3 Zeichen an.',
  invalid_amount: 'Bitte gib einen gültigen Betrag an (0,01 € bis 10.000 €).',
  invalid_note: 'Die Notiz ist zu lang.',
  invalid_player: 'Unbekannter Spieler.',
  invalid_reference: 'Die referenzierte Buchung existiert nicht.',
  invalid_name: 'Bitte gib einen gültigen Namen an.',
  invalid_color: 'Ungültige Farbe.',
  invalid_role: 'Ungültige Rolle.',
  invalid_request: 'Ungültige Anfrage.',
  room_limit: 'Du hast bereits die maximale Anzahl an Clubs angelegt.',
  players_missing: 'Spieler fehlen in diesem Club.',
  unsupported_ruleset: 'Das Regelwerk dieser Partie wird nicht unterstützt.',
  immutable_record: 'Dieser Datensatz ist unveränderlich.',
  stake_immutable: 'Der Einsatz einer Partie kann nach dem Start nicht geändert werden.',
  not_supported_local: 'Im lokalen Modus ist diese Funktion nicht verfügbar (kein gemeinsamer Server).',
  game_complete: 'Beide Wertungsblöcke sind vollständig – die Partie muss abgeschlossen und abgerechnet werden.',
  cannot_remove_self: 'Du kannst dich nicht selbst entfernen.',
  member_not_found: 'Dieses Mitglied wurde nicht gefunden.',
  network: 'Keine Verbindung zum Server. Bitte Internetverbindung prüfen und erneut versuchen.',
  unknown: 'Unerwarteter Fehler. Bitte erneut versuchen.',
};

export class BackendError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? ERROR_MESSAGES[code] ?? ERROR_MESSAGES.unknown);
    this.name = 'BackendError';
  }
}

/** Codes, nach denen der Client den Serverstand neu laden sollte. */
export const REFRESH_CODES = new Set(['stale_version', 'wrong_turn', 'game_not_active', 'category_taken', 'active_game_exists']);

export function toBackendError(error: unknown): BackendError {
  if (error instanceof BackendError) return error;
  const e = error as { message?: string; code?: string; details?: string; status?: number } | null;
  const message = e?.message ?? '';
  const kc = /kc_error:([a-z_]+)/.exec(message);
  if (kc?.[1]) return new BackendError(kc[1]);
  // PostgREST: Funktion/Tabelle fehlt → Migrationen nicht ausgeführt.
  if (e?.code === 'PGRST202' || e?.code === 'PGRST205' || e?.code === '42P01' || e?.code === '42883') {
    return new BackendError('database_not_ready');
  }
  if (e?.code === '42501') return new BackendError('forbidden');
  if (/anonymous sign-ins are disabled/i.test(message)) return new BackendError('anonymous_disabled');
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(message)) {
    return new BackendError('network');
  }
  return new BackendError('unknown');
}
