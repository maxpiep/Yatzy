-- Kniffel Club – kritische Vorgänge als atomare, serverseitig validierte Funktionen.
-- Jede Funktion läuft in genau einer Transaktion: scheitert ein Schritt, wird alles zurückgerollt.
-- Fehler werden als 'kc_error:<code>' gemeldet und im Frontend übersetzt.

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen
-- ---------------------------------------------------------------------------
create or replace function private.kc_uid()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    perform private.kc_raise('not_authenticated');
  end if;
  return v;
end;
$$;

-- Für RLS-Policies: ist der aktuelle Nutzer Mitglied des Raums?
create or replace function private.is_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_members m
    where m.room_id = p_room_id and m.user_id = auth.uid()
  );
$$;

create or replace function private.kc_require_member(p_room_id uuid, p_owner boolean default false)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  select m.role into v_role
  from public.room_members m
  where m.room_id = p_room_id and m.user_id = private.kc_uid();
  if v_role is null then
    perform private.kc_raise('forbidden');
  end if;
  if p_owner and v_role <> 'owner' then
    perform private.kc_raise('owner_required');
  end if;
  return v_role;
end;
$$;

create or replace function private.kc_new_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select encode(extensions.gen_random_bytes(24), 'hex');
$$;

create or replace function private.kc_hash_token(p_token text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select sha256(convert_to(p_token, 'UTF8'));
$$;

create or replace function private.kc_create_invite(p_room_id uuid, p_role text, p_user uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token text := private.kc_new_token();
begin
  insert into public.room_invites (room_id, token_hash, role, created_by, expires_at)
  values (
    p_room_id,
    private.kc_hash_token(v_token),
    p_role,
    p_user,
    case when p_role = 'owner' then now() + interval '10 years' else now() + interval '14 days' end
  );
  return v_token;
end;
$$;

create or replace function private.kc_log(p_game_id uuid, p_room_id uuid, p_type text, p_payload jsonb)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.game_events (game_id, room_id, event_type, payload, actor)
  values (p_game_id, p_room_id, p_type, coalesce(p_payload, '{}'::jsonb), auth.uid());
$$;

create or replace function private.kc_turn_player(p_game public.games, p_turn integer)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_turn % 2 = 1 then p_game.starting_player_id
    else (select p.id from public.players p
          where p.room_id = p_game.room_id and p.id <> p_game.starting_player_id
          order by p.slug limit 1)
  end;
$$;

-- Sperrt die Partie (FOR UPDATE) und prüft Mitgliedschaft, Status und Version.
create or replace function private.kc_lock_game(p_game_id uuid, p_expected_version integer)
returns public.games
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  g public.games;
begin
  select * into g from public.games where id = p_game_id for update;
  if not found then
    perform private.kc_raise('game_not_found');
  end if;
  perform private.kc_require_member(g.room_id);
  if g.status <> 'active' then
    perform private.kc_raise('game_not_active');
  end if;
  if p_expected_version is not null and g.version <> p_expected_version then
    perform private.kc_raise('stale_version', g.version::text);
  end if;
  return g;
end;
$$;

-- ---------------------------------------------------------------------------
-- Räume & Einladungen
-- ---------------------------------------------------------------------------
create or replace function public.create_room(
  p_name text,
  p_maxi_name text default 'Maxi',
  p_franzi_name text default 'Franzi'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.kc_uid();
  v_room public.rooms;
  v_count integer;
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 60 then
    perform private.kc_raise('invalid_name');
  end if;
  if char_length(btrim(coalesce(p_maxi_name, ''))) not between 1 and 30
     or char_length(btrim(coalesce(p_franzi_name, ''))) not between 1 and 30 then
    perform private.kc_raise('invalid_name');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('kc_create_room:' || v_user::text, 0));
  select count(*) into v_count from public.rooms where created_by = v_user;
  if v_count >= 5 then
    perform private.kc_raise('room_limit');
  end if;

  insert into public.rooms (name, created_by) values (btrim(p_name), v_user) returning * into v_room;
  insert into public.room_members (room_id, user_id, role) values (v_room.id, v_user, 'owner');
  -- Idempotente Initialisierung von Maxi und Franzi.
  insert into public.players (room_id, slug, display_name, color) values
    (v_room.id, 'maxi', btrim(p_maxi_name), '#2f6f8f'),
    (v_room.id, 'franzi', btrim(p_franzi_name), '#c2513f')
  on conflict (room_id, slug) do nothing;

  return jsonb_build_object(
    'room_id', v_room.id,
    'member_token', private.kc_create_invite(v_room.id, 'member', v_user),
    'owner_token', private.kc_create_invite(v_room.id, 'owner', v_user)
  );
end;
$$;

create or replace function public.join_room(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.kc_uid();
  v_inv public.room_invites;
  v_role text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then
    perform private.kc_raise('invalid_invite');
  end if;
  select * into v_inv from public.room_invites
  where token_hash = private.kc_hash_token(p_token)
  for update;
  if not found or v_inv.revoked_at is not null or v_inv.expires_at < now() then
    perform private.kc_raise('invalid_invite');
  end if;

  insert into public.room_members (room_id, user_id, role)
  values (v_inv.room_id, v_user, v_inv.role)
  on conflict (room_id, user_id) do update
    set role = case when excluded.role = 'owner' then 'owner' else public.room_members.role end
  returning role into v_role;

  -- Admin-Links sind nur einmal verwendbar; Einladungen für Mitglieder bis zum Ablauf.
  update public.room_invites set
    use_count = use_count + 1,
    last_used_at = now(),
    revoked_at = case when v_inv.role = 'owner' then now() else revoked_at end
  where id = v_inv.id;
  return jsonb_build_object('room_id', v_inv.room_id, 'role', v_role);
end;
$$;

-- Erzeugt einen neuen Einladungslink und widerruft alle bisherigen derselben Rolle.
create or replace function public.rotate_invite(p_room_id uuid, p_role text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.kc_uid();
begin
  perform private.kc_require_member(p_room_id, true);
  if p_role not in ('owner', 'member') then
    perform private.kc_raise('invalid_role');
  end if;
  update public.room_invites set revoked_at = now()
  where room_id = p_room_id and role = p_role and revoked_at is null;
  return private.kc_create_invite(p_room_id, p_role, v_user);
end;
$$;

create or replace function public.update_room(p_room_id uuid, p_name text)
returns public.rooms
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
begin
  perform private.kc_require_member(p_room_id, true);
  if p_name is null or char_length(btrim(p_name)) not between 1 and 60 then
    perform private.kc_raise('invalid_name');
  end if;
  update public.rooms set name = btrim(p_name) where id = p_room_id returning * into v_room;
  return v_room;
end;
$$;

create or replace function public.update_player(p_player_id uuid, p_display_name text, p_color text)
returns public.players
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_player public.players;
begin
  select * into v_player from public.players where id = p_player_id;
  if not found then
    perform private.kc_raise('invalid_player');
  end if;
  perform private.kc_require_member(v_player.room_id);
  if p_display_name is null or char_length(btrim(p_display_name)) not between 1 and 30 then
    perform private.kc_raise('invalid_name');
  end if;
  if p_color is null or lower(p_color) !~ '^#[0-9a-f]{6}$' then
    perform private.kc_raise('invalid_color');
  end if;
  update public.players set display_name = btrim(p_display_name), color = lower(p_color)
  where id = p_player_id returning * into v_player;
  return v_player;
end;
$$;

-- ---------------------------------------------------------------------------
-- Partie starten – nur mit gültigem Einsatz (100, 200, 500 Cent)
-- ---------------------------------------------------------------------------
create or replace function public.create_game(p_room_id uuid, p_stake_cents integer, p_idempotency_key uuid)
returns public.games
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.kc_uid();
  g public.games;
  v_last_start uuid;
  v_start uuid;
  v_snapshot jsonb;
begin
  perform private.kc_require_member(p_room_id);
  if p_stake_cents is null or p_stake_cents not in (100, 200, 500) then
    perform private.kc_raise('invalid_stake');
  end if;
  if p_idempotency_key is null then
    perform private.kc_raise('invalid_request');
  end if;

  -- Serialisiert Partiestarts pro Raum.
  perform 1 from public.rooms where id = p_room_id for update;

  -- Idempotenz: derselbe Schlüssel liefert dieselbe Partie (Doppelklick, Netzwerk-Retry).
  select * into g from public.games where room_id = p_room_id and idempotency_key = p_idempotency_key;
  if found then
    if g.stake_amount_cents <> p_stake_cents then
      perform private.kc_raise('idempotency_conflict');
    end if;
    return g;
  end if;

  if exists (select 1 from public.games where room_id = p_room_id and status = 'active') then
    perform private.kc_raise('active_game_exists');
  end if;

  -- Startspieler wechselt von Partie zu Partie; die erste Partie beginnt Maxi.
  select starting_player_id into v_last_start from public.games
  where room_id = p_room_id order by started_at desc, id desc limit 1;
  select p.id into v_start from public.players p
  where p.room_id = p_room_id and (v_last_start is null or p.id <> v_last_start)
  order by case when p.slug = 'maxi' then 0 else 1 end
  limit 1;

  select jsonb_agg(jsonb_build_object('id', p.id, 'slug', p.slug, 'display_name', p.display_name) order by p.slug desc)
  into v_snapshot
  from public.players p where p.room_id = p_room_id;
  if v_start is null or jsonb_array_length(v_snapshot) <> 2 then
    perform private.kc_raise('players_missing');
  end if;

  insert into public.games (
    room_id, ruleset_id, ruleset_version, stake_amount_cents, starting_player_id,
    players_snapshot, created_by, idempotency_key
  ) values (
    p_room_id, 'kniffel-schmidt', 1, p_stake_cents, v_start, v_snapshot, v_user, p_idempotency_key
  ) returning * into g;

  perform private.kc_log(g.id, g.room_id, 'game_created',
    jsonb_build_object('stake_amount_cents', p_stake_cents, 'starting_player_id', v_start));
  return g;
end;
$$;

-- ---------------------------------------------------------------------------
-- Wurf bestätigen (max. 3 pro Zug, gehaltene Würfel behalten ihren Wert)
-- ---------------------------------------------------------------------------
create or replace function public.confirm_roll(
  p_game_id uuid,
  p_expected_version integer,
  p_turn_no integer,
  p_dice smallint[],
  p_held boolean[]
)
returns public.games
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.kc_uid();
  g public.games;
  v_prev public.game_rolls;
  v_roll_no integer;
  v_player uuid;
  i integer;
  v_any_reroll boolean := false;
begin
  g := private.kc_lock_game(p_game_id, p_expected_version);
  if g.current_turn > 26 or p_turn_no is distinct from g.current_turn then
    perform private.kc_raise('wrong_turn');
  end if;
  perform private.kc_validate_dice(p_dice);
  if p_held is null or cardinality(p_held) <> 5 or array_ndims(p_held) <> 1 or array_lower(p_held, 1) <> 1
     or array_position(p_held, null) is not null then
    perform private.kc_raise('invalid_hold');
  end if;

  select * into v_prev from public.game_rolls
  where game_id = g.id and turn_no = g.current_turn
  order by roll_no desc limit 1;

  if not found then
    v_roll_no := 1;
    if true = any (p_held) then
      perform private.kc_raise('invalid_hold');
    end if;
  else
    v_roll_no := v_prev.roll_no + 1;
    if v_roll_no > 3 then
      perform private.kc_raise('max_rolls_reached');
    end if;
    for i in 1..5 loop
      if p_held[i] then
        if p_dice[i] <> v_prev.dice[i] then
          perform private.kc_raise('invalid_hold');
        end if;
      else
        v_any_reroll := true;
      end if;
    end loop;
    if not v_any_reroll then
      perform private.kc_raise('invalid_hold');
    end if;
  end if;

  v_player := private.kc_turn_player(g, g.current_turn);
  insert into public.game_rolls (game_id, room_id, turn_no, roll_no, player_id, dice, held, created_by)
  values (g.id, g.room_id, g.current_turn, v_roll_no, v_player, p_dice, p_held, v_user);

  update public.games set version = version + 1 where id = g.id returning * into g;
  perform private.kc_log(g.id, g.room_id, 'roll_confirmed', jsonb_build_object(
    'turn_no', p_turn_no, 'roll_no', v_roll_no, 'player_id', v_player, 'dice', to_jsonb(p_dice), 'held', to_jsonb(p_held)));
  return g;
end;
$$;

-- ---------------------------------------------------------------------------
-- Kategorie werten (Würfel stammen aus dem zuletzt bestätigten Serverwurf)
-- ---------------------------------------------------------------------------
create or replace function public.score_turn(
  p_game_id uuid,
  p_expected_version integer,
  p_turn_no integer,
  p_category text,
  p_strike boolean default false
)
returns public.games
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.kc_uid();
  g public.games;
  v_roll public.game_rolls;
  v_player uuid;
  v_kniffel integer;
  v_eval record;
begin
  g := private.kc_lock_game(p_game_id, p_expected_version);
  perform private.kc_assert_ruleset(g.ruleset_id, g.ruleset_version);
  if g.current_turn > 26 or p_turn_no is distinct from g.current_turn then
    perform private.kc_raise('wrong_turn');
  end if;
  if private.kc_max_score(p_category) is null then
    perform private.kc_raise('invalid_category');
  end if;

  select * into v_roll from public.game_rolls
  where game_id = g.id and turn_no = g.current_turn
  order by roll_no desc limit 1;
  if not found then
    perform private.kc_raise('no_roll');
  end if;

  v_player := private.kc_turn_player(g, g.current_turn);
  if exists (select 1 from public.game_scores where game_id = g.id and player_id = v_player and category = p_category) then
    perform private.kc_raise('category_taken');
  end if;

  select points into v_kniffel from public.game_scores
  where game_id = g.id and player_id = v_player and category = 'kniffel';

  select * into v_eval from private.kc_evaluate(v_roll.dice, p_category, v_kniffel, coalesce(p_strike, false));

  insert into public.game_scores (
    game_id, room_id, player_id, category, kind, points, dice, joker, strike_requested, kniffel_bonus, turn_no, created_by
  ) values (
    g.id, g.room_id, v_player, p_category,
    case when v_eval.points = 0 then 'struck' else 'scored' end,
    v_eval.points, v_roll.dice, v_eval.joker, coalesce(p_strike, false), v_eval.kniffel_bonus, g.current_turn, v_user
  );

  update public.games set current_turn = current_turn + 1, version = version + 1
  where id = g.id returning * into g;

  perform private.kc_log(g.id, g.room_id, 'category_scored', jsonb_build_object(
    'turn_no', p_turn_no, 'player_id', v_player, 'category', p_category, 'points', v_eval.points,
    'joker', v_eval.joker, 'kniffel_bonus', v_eval.kniffel_bonus, 'struck', v_eval.points = 0));
  return g;
end;
$$;

-- ---------------------------------------------------------------------------
-- Protokollierte Korrektur einer gespeicherten Wertung (nur in laufender Partie)
-- ---------------------------------------------------------------------------
create or replace function public.correct_score(
  p_game_id uuid,
  p_expected_version integer,
  p_player_id uuid,
  p_category text,
  p_dice smallint[],
  p_strike boolean,
  p_reason text
)
returns public.games
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.kc_uid();
  g public.games;
  s public.game_scores;
  v_kniffel integer;
  v_eval record;
  v_dice smallint[];
  x public.game_scores;
  v_next record;
begin
  g := private.kc_lock_game(p_game_id, p_expected_version);
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 300 then
    perform private.kc_raise('reason_required');
  end if;
  select * into s from public.game_scores
  where game_id = g.id and player_id = p_player_id and category = p_category
  for update;
  if not found then
    perform private.kc_raise('score_not_found');
  end if;
  v_dice := coalesce(p_dice, s.dice);
  perform private.kc_validate_dice(v_dice);

  -- Kontext: Kniffel-Feld zum Zeitpunkt der ursprünglichen Wertung.
  select points into v_kniffel from public.game_scores
  where game_id = g.id and player_id = p_player_id and category = 'kniffel' and turn_no < s.turn_no;

  select * into v_eval from private.kc_evaluate(v_dice, p_category, v_kniffel, coalesce(p_strike, false));

  insert into public.score_corrections (score_id, game_id, room_id, player_id, category, old_value, new_value, reason, created_by)
  values (
    s.id, g.id, g.room_id, p_player_id, p_category,
    jsonb_build_object('points', s.points, 'kind', s.kind, 'dice', to_jsonb(s.dice), 'joker', s.joker, 'kniffel_bonus', s.kniffel_bonus),
    jsonb_build_object('points', v_eval.points, 'kind', case when v_eval.points = 0 then 'struck' else 'scored' end,
                       'dice', to_jsonb(v_dice), 'joker', v_eval.joker, 'kniffel_bonus', v_eval.kniffel_bonus),
    btrim(p_reason), v_user
  );

  update public.game_scores set
    points = v_eval.points,
    kind = case when v_eval.points = 0 then 'struck' else 'scored' end,
    dice = v_dice,
    joker = v_eval.joker,
    strike_requested = coalesce(p_strike, false),
    kniffel_bonus = v_eval.kniffel_bonus,
    corrected_at = now(),
    correction_count = correction_count + 1
  where id = s.id;

  -- Folgekorrektur: Ändert sich das Kniffel-Feld, werden spätere Kniffel-Würfe dieses Spielers
  -- (Zusatzpunkte und Joker hängen davon ab) neu bewertet. Gestrichene Felder bleiben gestrichen.
  if p_category = 'kniffel' then
    for x in
      select * from public.game_scores
      where game_id = g.id and player_id = p_player_id and turn_no > s.turn_no and private.kc_is_kniffel(dice)
      order by turn_no
      for update
    loop
      select * into v_next from private.kc_evaluate(x.dice, x.category, v_eval.points, x.strike_requested);
      if v_next.points <> x.points or v_next.joker <> x.joker or v_next.kniffel_bonus <> x.kniffel_bonus then
        insert into public.score_corrections (score_id, game_id, room_id, player_id, category, old_value, new_value, reason, created_by)
        values (
          x.id, g.id, g.room_id, p_player_id, x.category,
          jsonb_build_object('points', x.points, 'kind', x.kind, 'dice', to_jsonb(x.dice), 'joker', x.joker, 'kniffel_bonus', x.kniffel_bonus),
          jsonb_build_object('points', v_next.points, 'kind', case when v_next.points = 0 then 'struck' else 'scored' end,
                             'dice', to_jsonb(x.dice), 'joker', v_next.joker, 'kniffel_bonus', v_next.kniffel_bonus),
          left('Folgekorrektur (Kniffel-Feld geändert): ' || btrim(p_reason), 300), v_user
        );
        update public.game_scores set
          points = v_next.points,
          kind = case when v_next.points = 0 then 'struck' else 'scored' end,
          joker = v_next.joker,
          kniffel_bonus = v_next.kniffel_bonus,
          corrected_at = now(),
          correction_count = correction_count + 1
        where id = x.id;
      end if;
    end loop;
  end if;

  update public.games set version = version + 1 where id = g.id returning * into g;
  perform private.kc_log(g.id, g.room_id, 'score_corrected', jsonb_build_object(
    'player_id', p_player_id, 'category', p_category, 'old_points', s.points, 'new_points', v_eval.points,
    'reason', btrim(p_reason)));
  return g;
end;
$$;

-- ---------------------------------------------------------------------------
-- Partie abschließen und Kasse atomar abrechnen (idempotent)
-- ---------------------------------------------------------------------------
create or replace function public.finish_game(p_game_id uuid)
returns public.games
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.kc_uid();
  g public.games;
  v_a uuid;
  v_b uuid;
  v_ta jsonb;
  v_tb jsonb;
  v_sa integer;
  v_sb integer;
  v_winner uuid;
  v_loser uuid;
  v_entry_id uuid;
  v_label text;
begin
  select * into g from public.games where id = p_game_id for update;
  if not found then
    perform private.kc_raise('game_not_found');
  end if;
  perform private.kc_require_member(g.room_id);
  -- Erneuter oder gleichzeitiger Abschluss: bestehendes Ergebnis zurückgeben, nichts doppelt buchen.
  if g.status = 'finished' then
    return g;
  end if;
  if g.status = 'cancelled' then
    perform private.kc_raise('game_cancelled');
  end if;
  perform private.kc_assert_ruleset(g.ruleset_id, g.ruleset_version);

  select (e ->> 'id')::uuid into v_a from jsonb_array_elements(g.players_snapshot) e where e ->> 'slug' = 'maxi';
  select (e ->> 'id')::uuid into v_b from jsonb_array_elements(g.players_snapshot) e where e ->> 'slug' = 'franzi';

  -- Beide Scorecards müssen vollständig sein (13 Felder je Spieler, 26 Züge).
  if g.current_turn <> 27
     or (select count(*) from public.game_scores where game_id = g.id and player_id = v_a) <> 13
     or (select count(*) from public.game_scores where game_id = g.id and player_id = v_b) <> 13 then
    perform private.kc_raise('game_incomplete');
  end if;

  v_ta := private.kc_totals(g.id, v_a);
  v_tb := private.kc_totals(g.id, v_b);
  v_sa := (v_ta ->> 'total')::int;
  v_sb := (v_tb ->> 'total')::int;

  if v_sa > v_sb then v_winner := v_a; v_loser := v_b;
  elsif v_sb > v_sa then v_winner := v_b; v_loser := v_a;
  end if;

  if v_loser is not null then
    select coalesce(e ->> 'display_name', '?') into v_label
    from jsonb_array_elements(g.players_snapshot) e where (e ->> 'id')::uuid = v_loser;
    insert into public.cash_ledger (room_id, player_id, amount_cents, entry_type, description, created_by, game_id, idempotency_key)
    values (
      g.room_id, v_loser, g.stake_amount_cents, 'game_loss',
      format('Einsatz %s – Partie verloren (%s : %s)',
        replace(to_char(g.stake_amount_cents / 100.0, 'FM990.00'), '.', ',') || ' €',
        case when v_loser = v_a then v_sa else v_sb end,
        case when v_loser = v_a then v_sb else v_sa end),
      v_user, g.id, 'game_loss:' || g.id::text
    )
    on conflict do nothing
    returning id into v_entry_id;
  end if;

  update public.games set
    status = 'finished',
    finished_at = now(),
    winner_player_id = v_winner,
    is_draw = v_winner is null,
    final_scores = jsonb_build_object(v_a::text, v_sa, v_b::text, v_sb),
    final_breakdown = jsonb_build_object(v_a::text, v_ta, v_b::text, v_tb),
    settlement_status = case when v_loser is null then 'no_charge' else 'settled' end,
    settled_at = now(),
    version = version + 1
  where id = g.id
  returning * into g;

  perform private.kc_log(g.id, g.room_id, 'game_finished', jsonb_build_object(
    'scores', g.final_scores, 'winner_player_id', v_winner, 'is_draw', v_winner is null));
  perform private.kc_log(g.id, g.room_id, 'cash_settled', jsonb_build_object(
    'loser_player_id', v_loser, 'amount_cents', case when v_loser is null then 0 else g.stake_amount_cents end,
    'ledger_entry_id', v_entry_id));
  return g;
end;
$$;

create or replace function public.cancel_game(p_game_id uuid, p_reason text)
returns public.games
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  g public.games;
begin
  g := private.kc_lock_game(p_game_id, null);
  perform private.kc_require_member(g.room_id, true);
  -- Ein vollständiger Block muss abgerechnet werden; ein Abbruch würde den fälligen Einsatz umgehen.
  if g.current_turn > 26 then
    perform private.kc_raise('game_complete');
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 300 then
    perform private.kc_raise('reason_required');
  end if;
  update public.games set status = 'cancelled', settlement_status = 'void', cancel_reason = btrim(p_reason),
    version = version + 1
  where id = g.id returning * into g;
  perform private.kc_log(g.id, g.room_id, 'game_cancelled', jsonb_build_object('reason', btrim(p_reason)));
  return g;
end;
$$;

-- ---------------------------------------------------------------------------
-- Kasse: Zahlungen und Korrekturen
-- ---------------------------------------------------------------------------
create or replace function public.record_payment(
  p_room_id uuid,
  p_player_id uuid,
  p_amount_cents integer,
  p_note text,
  p_idempotency_key uuid
)
returns public.cash_ledger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.kc_uid();
  e public.cash_ledger;
  v_key text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform private.kc_require_member(p_room_id);
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 1000000 then
    perform private.kc_raise('invalid_amount');
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    perform private.kc_raise('invalid_note');
  end if;
  if not exists (select 1 from public.players where id = p_player_id and room_id = p_room_id) then
    perform private.kc_raise('invalid_player');
  end if;
  if p_idempotency_key is null then
    perform private.kc_raise('invalid_request');
  end if;
  v_key := 'payment:' || p_idempotency_key::text;

  select * into e from public.cash_ledger where room_id = p_room_id and idempotency_key = v_key;
  if found then
    if e.player_id <> p_player_id or e.amount_cents <> -p_amount_cents then
      perform private.kc_raise('idempotency_conflict');
    end if;
    return e;
  end if;

  insert into public.cash_ledger (room_id, player_id, amount_cents, entry_type, description, created_by, idempotency_key)
  values (p_room_id, p_player_id, -p_amount_cents, 'payment',
          case when v_note is null then 'Zahlung' else 'Zahlung – ' || v_note end, v_user, v_key)
  on conflict (room_id, idempotency_key) do nothing
  returning * into e;
  if e.id is null then
    select * into e from public.cash_ledger where room_id = p_room_id and idempotency_key = v_key;
    if e.player_id <> p_player_id or e.amount_cents <> -p_amount_cents then
      perform private.kc_raise('idempotency_conflict');
    end if;
  end if;
  return e;
end;
$$;

create or replace function public.record_adjustment(
  p_room_id uuid,
  p_player_id uuid,
  p_amount_cents integer,
  p_reason text,
  p_corrects_entry_id uuid,
  p_idempotency_key uuid
)
returns public.cash_ledger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.kc_uid();
  e public.cash_ledger;
  v_key text;
begin
  perform private.kc_require_member(p_room_id, true);
  if p_amount_cents is null or p_amount_cents = 0 or abs(p_amount_cents) > 1000000 then
    perform private.kc_raise('invalid_amount');
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 300 then
    perform private.kc_raise('reason_required');
  end if;
  if not exists (select 1 from public.players where id = p_player_id and room_id = p_room_id) then
    perform private.kc_raise('invalid_player');
  end if;
  if p_corrects_entry_id is not null and not exists (
    select 1 from public.cash_ledger where id = p_corrects_entry_id and room_id = p_room_id
  ) then
    perform private.kc_raise('invalid_reference');
  end if;
  if p_idempotency_key is null then
    perform private.kc_raise('invalid_request');
  end if;
  v_key := 'adjustment:' || p_idempotency_key::text;

  select * into e from public.cash_ledger where room_id = p_room_id and idempotency_key = v_key;
  if found then
    if e.player_id <> p_player_id or e.amount_cents <> p_amount_cents then
      perform private.kc_raise('idempotency_conflict');
    end if;
    return e;
  end if;

  insert into public.cash_ledger (room_id, player_id, amount_cents, entry_type, description, created_by, idempotency_key, corrects_entry_id)
  values (p_room_id, p_player_id, p_amount_cents, 'adjustment', 'Korrektur – ' || btrim(p_reason), v_user, v_key, p_corrects_entry_id)
  on conflict (room_id, idempotency_key) do nothing
  returning * into e;
  if e.id is null then
    select * into e from public.cash_ledger where room_id = p_room_id and idempotency_key = v_key;
    if e.player_id <> p_player_id or e.amount_cents <> p_amount_cents then
      perform private.kc_raise('idempotency_conflict');
    end if;
  end if;
  return e;
end;
$$;

-- ---------------------------------------------------------------------------
-- Mitglieder verwalten
-- ---------------------------------------------------------------------------
create or replace function public.remove_member(p_room_id uuid, p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.kc_uid();
begin
  perform private.kc_require_member(p_room_id, true);
  if p_user_id = v_user then
    perform private.kc_raise('cannot_remove_self');
  end if;
  delete from public.room_members where room_id = p_room_id and user_id = p_user_id;
  if not found then
    perform private.kc_raise('member_not_found');
  end if;
end;
$$;
