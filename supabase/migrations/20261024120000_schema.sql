-- Kniffel Club – Schema
-- Alle schreibenden Vorgänge laufen ausschließlich über SECURITY-DEFINER-Funktionen
-- (siehe 20261024120200_rpc.sql). Clients haben nur Lesezugriff über RLS.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Räume und Mitgliedschaften
-- ---------------------------------------------------------------------------
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  created_by uuid not null,
  config jsonb not null default '{}'::jsonb
);

create table public.room_members (
  room_id uuid not null references public.rooms (id) on delete restrict,
  user_id uuid not null,
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index room_members_user_idx on public.room_members (user_id);

-- Einladungen: es wird nur der SHA-256-Hash des Tokens gespeichert.
create table public.room_invites (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete restrict,
  token_hash bytea not null unique,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  created_by uuid not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  use_count integer not null default 0 check (use_count >= 0)
);
create index room_invites_room_idx on public.room_invites (room_id);

-- ---------------------------------------------------------------------------
-- Spieler (pro Raum genau Maxi und Franzi, idempotent angelegt)
-- ---------------------------------------------------------------------------
create table public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete restrict,
  slug text not null check (slug in ('maxi', 'franzi')),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 30),
  color text not null check (color ~ '^#[0-9a-f]{6}$'),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (room_id, slug),
  unique (room_id, id)
);

-- ---------------------------------------------------------------------------
-- Partien
-- ---------------------------------------------------------------------------
create table public.games (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'finished', 'cancelled')),
  ruleset_id text not null,
  ruleset_version integer not null check (ruleset_version > 0),
  -- Unveränderlicher Einsatz-Snapshot dieser Partie (ganze Cent).
  stake_amount_cents integer not null check (stake_amount_cents in (100, 200, 500)),
  starting_player_id uuid not null,
  current_turn integer not null default 1 check (current_turn between 1 and 27),
  version integer not null default 1 check (version > 0),
  -- Namens-Snapshot der Spieler zum Partiestart (spätere Profiländerungen wirken nicht rückwirkend).
  players_snapshot jsonb not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  winner_player_id uuid,
  is_draw boolean,
  final_scores jsonb,
  final_breakdown jsonb,
  settlement_status text not null default 'pending'
    check (settlement_status in ('pending', 'settled', 'no_charge', 'void')),
  settled_at timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 300),
  created_by uuid not null,
  idempotency_key uuid not null,
  unique (room_id, idempotency_key),
  unique (room_id, id),
  foreign key (room_id, starting_player_id) references public.players (room_id, id),
  foreign key (room_id, winner_player_id) references public.players (room_id, id),
  check ((status = 'finished') = (finished_at is not null and final_scores is not null and is_draw is not null)),
  check (status <> 'finished' or settlement_status in ('settled', 'no_charge')),
  check (status <> 'cancelled' or settlement_status = 'void'),
  check (status <> 'active' or settlement_status = 'pending'),
  check (is_draw is distinct from true or winner_player_id is null),
  check (is_draw is distinct from false or winner_player_id is not null)
);
-- Höchstens eine laufende Partie pro Raum (schützt zusätzlich vor Doppelstarts).
create unique index games_one_active_per_room on public.games (room_id) where status = 'active';
create index games_room_started_idx on public.games (room_id, started_at desc);

create table public.game_rolls (
  id bigint generated always as identity primary key,
  game_id uuid not null,
  room_id uuid not null,
  turn_no integer not null check (turn_no between 1 and 26),
  roll_no integer not null check (roll_no between 1 and 3),
  player_id uuid not null,
  dice smallint[] not null check (cardinality(dice) = 5 and dice <@ array[1, 2, 3, 4, 5, 6]::smallint[]),
  held boolean[] not null check (cardinality(held) = 5),
  created_at timestamptz not null default now(),
  created_by uuid not null,
  unique (game_id, turn_no, roll_no),
  foreign key (room_id, game_id) references public.games (room_id, id),
  foreign key (room_id, player_id) references public.players (room_id, id)
);

create table public.game_scores (
  id bigint generated always as identity primary key,
  game_id uuid not null,
  room_id uuid not null,
  player_id uuid not null,
  category text not null check (category in (
    'ones', 'twos', 'threes', 'fours', 'fives', 'sixes',
    'three_kind', 'four_kind', 'full_house', 'small_straight', 'large_straight', 'kniffel', 'chance'
  )),
  kind text not null check (kind in ('scored', 'struck')),
  points integer not null check (points between 0 and 50),
  dice smallint[] not null check (cardinality(dice) = 5 and dice <@ array[1, 2, 3, 4, 5, 6]::smallint[]),
  joker boolean not null default false,
  kniffel_bonus integer not null default 0 check (kniffel_bonus in (0, 50)),
  turn_no integer not null check (turn_no between 1 and 26),
  created_at timestamptz not null default now(),
  created_by uuid not null,
  corrected_at timestamptz,
  correction_count integer not null default 0 check (correction_count >= 0),
  -- Keine doppelten Wertungen: ein Feld pro Spieler und Partie, eine Wertung pro Zug.
  unique (game_id, player_id, category),
  unique (game_id, turn_no),
  check ((kind = 'struck') = (points = 0)),
  foreign key (room_id, game_id) references public.games (room_id, id),
  foreign key (room_id, player_id) references public.players (room_id, id)
);

create table public.score_corrections (
  id bigint generated always as identity primary key,
  score_id bigint not null references public.game_scores (id),
  game_id uuid not null,
  room_id uuid not null,
  player_id uuid not null,
  category text not null,
  old_value jsonb not null,
  new_value jsonb not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 300),
  created_at timestamptz not null default now(),
  created_by uuid not null,
  foreign key (room_id, game_id) references public.games (room_id, id)
);

create table public.game_events (
  id bigint generated always as identity primary key,
  game_id uuid not null,
  room_id uuid not null,
  event_type text not null check (event_type in (
    'game_created', 'roll_confirmed', 'category_scored', 'score_corrected',
    'game_finished', 'cash_settled', 'game_cancelled'
  )),
  payload jsonb not null default '{}'::jsonb,
  actor uuid,
  created_at timestamptz not null default now(),
  foreign key (room_id, game_id) references public.games (room_id, id)
);
create index game_events_game_idx on public.game_events (game_id, id);

-- ---------------------------------------------------------------------------
-- Kniffelkasse – unveränderliches Kassenbuch
-- amount_cents > 0: Verbindlichkeit steigt (Einsatz), < 0: sinkt (Zahlung).
-- ---------------------------------------------------------------------------
create table public.cash_ledger (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete restrict,
  player_id uuid not null,
  amount_cents integer not null check (amount_cents <> 0 and abs(amount_cents) <= 1000000),
  entry_type text not null check (entry_type in ('game_loss', 'payment', 'adjustment')),
  description text not null check (char_length(btrim(description)) between 1 and 300),
  created_at timestamptz not null default now(),
  created_by uuid not null,
  game_id uuid,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  corrects_entry_id uuid references public.cash_ledger (id),
  unique (room_id, idempotency_key),
  foreign key (room_id, player_id) references public.players (room_id, id),
  foreign key (room_id, game_id) references public.games (room_id, id),
  check (entry_type <> 'game_loss' or (game_id is not null and amount_cents in (100, 200, 500))),
  check (entry_type <> 'payment' or (amount_cents < 0 and game_id is null)),
  check (corrects_entry_id is null or entry_type = 'adjustment')
);
-- Pro Partie höchstens ein Einsatz – letzte Verteidigungslinie gegen Doppelbuchungen.
create unique index cash_ledger_one_loss_per_game on public.cash_ledger (game_id) where entry_type = 'game_loss';
create index cash_ledger_room_created_idx on public.cash_ledger (room_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Integritäts-Trigger
-- ---------------------------------------------------------------------------
create or replace function private.kc_raise(p_code text, p_detail text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = 'kc_error:' || p_code, detail = coalesce(p_detail, '');
end;
$$;

create or replace function private.trg_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.kc_raise('immutable_record', tg_table_name);
  return null;
end;
$$;

create trigger cash_ledger_immutable before update or delete on public.cash_ledger
  for each row execute function private.trg_immutable();
create trigger game_rolls_immutable before update or delete on public.game_rolls
  for each row execute function private.trg_immutable();
create trigger game_events_immutable before update or delete on public.game_events
  for each row execute function private.trg_immutable();
create trigger score_corrections_immutable before update or delete on public.score_corrections
  for each row execute function private.trg_immutable();
create trigger games_no_delete before delete on public.games
  for each row execute function private.trg_immutable();
create trigger game_scores_no_delete before delete on public.game_scores
  for each row execute function private.trg_immutable();

create or replace function private.trg_games_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stake_amount_cents is distinct from old.stake_amount_cents then
    perform private.kc_raise('stake_immutable');
  end if;
  if new.room_id is distinct from old.room_id
     or new.ruleset_id is distinct from old.ruleset_id
     or new.ruleset_version is distinct from old.ruleset_version
     or new.starting_player_id is distinct from old.starting_player_id
     or new.players_snapshot is distinct from old.players_snapshot
     or new.started_at is distinct from old.started_at
     or new.created_by is distinct from old.created_by
     or new.idempotency_key is distinct from old.idempotency_key then
    perform private.kc_raise('immutable_record', 'games');
  end if;
  if old.status <> 'active' then
    perform private.kc_raise('game_closed');
  end if;
  return new;
end;
$$;

create trigger games_guard before update on public.games
  for each row execute function private.trg_games_guard();

create or replace function private.trg_scores_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  if new.game_id is distinct from old.game_id
     or new.room_id is distinct from old.room_id
     or new.player_id is distinct from old.player_id
     or new.category is distinct from old.category
     or new.turn_no is distinct from old.turn_no
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    perform private.kc_raise('immutable_record', 'game_scores');
  end if;
  select g.status into v_status from public.games g where g.id = old.game_id;
  if v_status is distinct from 'active' then
    perform private.kc_raise('game_closed');
  end if;
  return new;
end;
$$;

create trigger game_scores_guard before update on public.game_scores
  for each row execute function private.trg_scores_guard();
