import { useState } from 'react';
import type { Player, PlayerSlug } from '../domain/types';
import { DEFAULT_RULESET } from '../domain/rules/ruleset';
import { playerProfileInput, roomNameSchema } from '../domain/validation';
import { readSupabaseConfig } from '../data/supabaseClient';
import { useClub, useSnapshot, type SyncState } from '../state/club';
import { usePreferences, type MotionPref, type ThemePref } from '../state/preferences';
import { Button } from '../ui/Button';
import { ConnectionStatus } from '../ui/ConnectionStatus';
import { CopyField, inviteUrl } from '../ui/CopyField';

const SYNC_TEXT: Record<SyncState, string> = {
  connecting: 'Verbinde mit dem Server …',
  synced: 'Echtzeit-Synchronisierung aktiv',
  offline: 'Verbindung unterbrochen – Änderungen werden nach Wiederverbindung geladen',
  saving: 'Speichert …',
  'save-failed': 'Letzter Speichervorgang fehlgeschlagen',
  local: 'Lokaler Modus – Daten nur auf diesem Gerät, keine Synchronisierung',
};

function PlayerProfile({ player }: { player: Player }) {
  const { run } = useClub();
  const [name, setName] = useState(player.displayName);
  const [color, setColor] = useState(player.color);
  const parsed = playerProfileInput.safeParse({ playerId: player.id, displayName: name, color });
  const dirty = name !== player.displayName || color !== player.color;
  return (
    <form
      className="field"
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed.success) void run((b) => b.updatePlayer(player.id, parsed.data.displayName, parsed.data.color), { success: 'Profil gespeichert' }).catch(() => {});
      }}
    >
      <label className="field__label" htmlFor={`name-${player.id}`}>
        Spieler {player.slug === 'maxi' ? '1' : '2'}
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input id={`name-${player.id}`} className="input" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
        <input type="color" className="input" style={{ width: 56, padding: 4 }} value={color} onChange={(e) => setColor(e.target.value)} aria-label={`Farbe von ${player.displayName}`} />
        <Button type="submit" disabled={!dirty || !parsed.success}>
          Speichern
        </Button>
      </div>
    </form>
  );
}

export function SettingsPage() {
  const snapshot = useSnapshot();
  const { run, backend, room, syncState } = useClub();
  const { prefs, setPref } = usePreferences();
  const [roomName, setRoomName] = useState(snapshot.room.name);
  const [links, setLinks] = useState<{ member?: string; owner?: string }>({});
  const isOwner = room?.role === 'owner';
  const config = readSupabaseConfig();
  const local = backend?.mode === 'local';

  const rotate = async (role: 'member' | 'owner') => {
    try {
      const token = await run((b) => b.rotateInvite(snapshot.room.id, role), { success: 'Neuer Link erstellt – alte Links dieser Art sind ungültig' });
      setLinks((l) => ({ ...l, [role]: inviteUrl(token) }));
    } catch {
      /* Toast */
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Einstellungen</h1>
          <p>Änderungen wirken nur auf künftige Partien – historische Partien behalten ihre gespeicherten Daten.</p>
        </div>
      </div>
      <div className="grid-2 settings">
        <div className="settings">
          <section className="panel">
            <h2>Club</h2>
            <form
              className="field"
              onSubmit={(e) => {
                e.preventDefault();
                const p = roomNameSchema.safeParse(roomName);
                if (p.success) void run((b) => b.updateRoom(snapshot.room.id, p.data), { success: 'Clubname gespeichert' }).catch(() => {});
              }}
            >
              <label className="field__label" htmlFor="room-name">
                Name
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input id="room-name" className="input" value={roomName} maxLength={60} disabled={!isOwner} onChange={(e) => setRoomName(e.target.value)} />
                {isOwner && (
                  <Button type="submit" disabled={roomName === snapshot.room.name}>
                    Speichern
                  </Button>
                )}
              </div>
              <span className="field__hint">Deine Rolle: {isOwner ? 'Admin' : 'Mitglied'}</span>
            </form>
          </section>

          <section className="panel">
            <h2>Spielerprofile</h2>
            {snapshot.players.map((p) => (
              <PlayerProfile key={`${p.id}:${p.displayName}:${p.color}`} player={p} />
            ))}
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="field__label">Dieses Gerät gehört</legend>
              <div className="segmented">
                {[...snapshot.players.map((p) => ({ v: p.slug as PlayerSlug | null, l: p.displayName })), { v: null, l: 'Gemeinsam' }].map((o) => (
                  <label key={o.l}>
                    <input type="radio" name="device" checked={prefs.device === o.v} onChange={() => setPref('device', o.v)} />
                    <span>{o.l}</span>
                  </label>
                ))}
              </div>
              <span className="field__hint">Nur zur Anzeige. Jedes Mitglied kann für beide Spieler eintragen – ihr spielt am selben Tisch.</span>
            </fieldset>
          </section>

          <section className="panel">
            <h2>Einladen</h2>
            {local ? (
              <p className="muted">Im lokalen Modus gibt es keinen gemeinsamen Server und keine Einladungen. Richte Supabase ein, um auf zwei Geräten zu spielen.</p>
            ) : isOwner ? (
              <>
                <p className="muted">
                  Einladungslinks sind 14 Tage gültig und geben Spielzugriff, aber keine Admin-Rechte. Aus Sicherheitsgründen wird nur ein Hash gespeichert – ein neuer Link
                  macht ältere ungültig.
                </p>
                {links.member ? <CopyField value={links.member} label="Einladungslink" /> : null}
                <Button onClick={() => rotate('member')}>Einladungslink erzeugen</Button>
                <hr className="divider" />
                <p className="muted">Admin-Link zur Wiederherstellung deiner Rechte auf einem neuen Gerät. Niemals teilen.</p>
                {links.owner ? <CopyField value={links.owner} label="Admin-Link" /> : null}
                <Button variant="ghost" onClick={() => rotate('owner')}>
                  Neuen Admin-Link erzeugen
                </Button>
              </>
            ) : (
              <p className="muted">Nur Admins können Einladungslinks erzeugen.</p>
            )}
          </section>
        </div>

        <div className="settings">
          <section className="panel">
            <h2>Verbindung</h2>
            <div>
              <ConnectionStatus />
            </div>
            <p className="muted">{SYNC_TEXT[syncState]}</p>
            <dl className="kv">
              <dt>Backend</dt>
              <dd>{local ? 'Lokal (Browser-Speicher)' : 'Supabase (PostgreSQL + Realtime)'}</dd>
              {!local && config && (
                <>
                  <dt>Projekt</dt>
                  <dd>{new URL(config.url).host}</dd>
                </>
              )}
              <dt>Regelwerk</dt>
              <dd>
                {DEFAULT_RULESET.name} (v{DEFAULT_RULESET.version})
              </dd>
            </dl>
          </section>

          <section className="panel">
            <h2>Anzeige</h2>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="field__label">Farbschema</legend>
              <div className="segmented">
                {(
                  [
                    ['system', 'System'],
                    ['light', 'Hell'],
                    ['dark', 'Dunkel'],
                  ] as [ThemePref, string][]
                ).map(([v, l]) => (
                  <label key={v}>
                    <input type="radio" name="theme" checked={prefs.theme === v} onChange={() => setPref('theme', v)} />
                    <span>{l}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="field__label">Animationen</legend>
              <div className="segmented">
                {(
                  [
                    ['system', 'System'],
                    ['reduced', 'Reduziert'],
                    ['full', 'Voll'],
                  ] as [MotionPref, string][]
                ).map(([v, l]) => (
                  <label key={v}>
                    <input type="radio" name="motion" checked={prefs.motion === v} onChange={() => setPref('motion', v)} />
                    <span>{l}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="switch">
              <span>
                Sanftes Scrollen
                <br />
                <span className="subtle">Nur mit Maus/Trackpad, nie bei reduzierten Animationen</span>
              </span>
              <input type="checkbox" checked={prefs.smoothScroll} onChange={(e) => setPref('smoothScroll', e.target.checked)} />
            </label>
          </section>

          <section className="panel">
            <h2>Regelwerk & Einsatz</h2>
            <ul className="rules-list">
              <li>5 Würfel, 13 Felder je Spieler, höchstens 3 Würfe pro Zug.</li>
              <li>Oberer Block ab 63 Punkten: +35 Bonus.</li>
              <li>Full House 25 · Kleine Straße (4 in Folge) 30 · Große Straße (5 in Folge) 40 · Kniffel 50.</li>
              <li>Jeder weitere Kniffel (Kniffel-Feld mit 50 belegt): +50 Zusatzpunkte und Joker – beliebiges freies Feld mit Höchstpunktzahl.</li>
              <li>Einsatz je Partie: 1 €, 2 € oder 5 € – vor dem Start verpflichtend gewählt und fest gespeichert.</li>
              <li>Der Verlierer wird mit dem Einsatz belastet, bei Unentschieden wird nichts berechnet.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
