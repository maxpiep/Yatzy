-- Kniffel Club – Row Level Security, Rechte und Realtime

-- ---------------------------------------------------------------------------
-- RLS aktivieren (alle Tabellen). Ohne Policy ist jeder Zugriff verboten.
-- ---------------------------------------------------------------------------
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_invites enable row level security;
alter table public.players enable row level security;
alter table public.games enable row level security;
alter table public.game_rolls enable row level security;
alter table public.game_scores enable row level security;
alter table public.score_corrections enable row level security;
alter table public.game_events enable row level security;
alter table public.cash_ledger enable row level security;

-- ---------------------------------------------------------------------------
-- Tabellenrechte: Clients dürfen nur lesen. Schreiben ausschließlich über Funktionen.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on
  public.rooms, public.room_members, public.players, public.games, public.game_rolls,
  public.game_scores, public.score_corrections, public.game_events, public.cash_ledger
to authenticated;
-- room_invites: kein Lesezugriff für Clients (nur Hashes, trotzdem nicht offenlegen).

grant usage on schema private to authenticated;
grant execute on function private.is_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Lese-Policies: nur Mitglieder des jeweiligen Raums
-- ---------------------------------------------------------------------------
create policy rooms_select on public.rooms
  for select to authenticated using (private.is_member(id));
create policy room_members_select on public.room_members
  for select to authenticated using (private.is_member(room_id));
create policy players_select on public.players
  for select to authenticated using (private.is_member(room_id));
create policy games_select on public.games
  for select to authenticated using (private.is_member(room_id));
create policy game_rolls_select on public.game_rolls
  for select to authenticated using (private.is_member(room_id));
create policy game_scores_select on public.game_scores
  for select to authenticated using (private.is_member(room_id));
create policy score_corrections_select on public.score_corrections
  for select to authenticated using (private.is_member(room_id));
create policy game_events_select on public.game_events
  for select to authenticated using (private.is_member(room_id));
create policy cash_ledger_select on public.cash_ledger
  for select to authenticated using (private.is_member(room_id));

-- ---------------------------------------------------------------------------
-- Funktionsrechte: standardmäßig niemand, dann gezielt authenticated.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon;
revoke execute on all functions in schema public from public, anon;
grant execute on function private.is_member(uuid) to authenticated;

grant execute on function public.create_room(text, text, text) to authenticated;
grant execute on function public.join_room(text) to authenticated;
grant execute on function public.rotate_invite(uuid, text) to authenticated;
grant execute on function public.update_room(uuid, text) to authenticated;
grant execute on function public.update_player(uuid, text, text) to authenticated;
grant execute on function public.create_game(uuid, integer, uuid) to authenticated;
grant execute on function public.confirm_roll(uuid, integer, integer, smallint[], boolean[]) to authenticated;
grant execute on function public.score_turn(uuid, integer, integer, text, boolean) to authenticated;
grant execute on function public.correct_score(uuid, integer, uuid, text, smallint[], boolean, text) to authenticated;
grant execute on function public.finish_game(uuid) to authenticated;
grant execute on function public.cancel_game(uuid, text) to authenticated;
grant execute on function public.record_payment(uuid, uuid, integer, text, uuid) to authenticated;
grant execute on function public.record_adjustment(uuid, uuid, integer, text, uuid, uuid) to authenticated;

-- Neue Funktionen sollen nicht automatisch für anon ausführbar sein.
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema private revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Realtime: Änderungen an diesen Tabellen werden an berechtigte Clients gesendet
-- (Supabase Realtime wertet die RLS-Policies je Abonnent aus).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.rooms, public.players, public.games, public.game_rolls,
      public.game_scores, public.cash_ledger;
  end if;
end;
$$;
