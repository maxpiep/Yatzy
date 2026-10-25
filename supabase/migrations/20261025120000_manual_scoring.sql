-- Kniffel Club – Direkteingabe wie auf dem Papierblock (Feld antippen, Wert wählen, bestätigen).
-- Gewürfelt wird mit echten Würfeln; gespeichert wird nur der Wert. Würfel werden dann leer gespeichert.

alter table public.game_scores drop constraint if exists game_scores_dice_check;
alter table public.game_scores add constraint game_scores_dice_check
  check (cardinality(dice) in (0, 5) and dice <@ array[1, 2, 3, 4, 5, 6]::smallint[]);

-- Ist `p_points` ein möglicher Wert für das Feld? (0 = streichen ist immer erlaubt)
create or replace function private.kc_manual_valid(p_category text, p_points integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_points is not null and (
    p_points = 0
    or case p_category
      when 'ones' then p_points between 1 and 5
      when 'twos' then p_points in (2, 4, 6, 8, 10)
      when 'threes' then p_points in (3, 6, 9, 12, 15)
      when 'fours' then p_points in (4, 8, 12, 16, 20)
      when 'fives' then p_points in (5, 10, 15, 20, 25)
      when 'sixes' then p_points in (6, 12, 18, 24, 30)
      when 'three_kind' then p_points between 5 and 30
      when 'four_kind' then p_points between 5 and 30
      when 'chance' then p_points between 5 and 30
      when 'full_house' then p_points = 25
      when 'small_straight' then p_points = 30
      when 'large_straight' then p_points = 40
      when 'kniffel' then p_points = 50
      else false
    end
  );
$$;

create or replace function public.score_manual(
  p_game_id uuid,
  p_expected_version integer,
  p_turn_no integer,
  p_category text,
  p_points integer,
  p_extra_kniffel boolean default false
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
  v_player uuid;
  v_kniffel integer;
  v_extra boolean := coalesce(p_extra_kniffel, false);
begin
  g := private.kc_lock_game(p_game_id, p_expected_version);
  perform private.kc_assert_ruleset(g.ruleset_id, g.ruleset_version);
  if g.current_turn > 26 or p_turn_no is distinct from g.current_turn then
    perform private.kc_raise('wrong_turn');
  end if;
  if private.kc_max_score(p_category) is null then
    perform private.kc_raise('invalid_category');
  end if;
  if not private.kc_manual_valid(p_category, p_points) then
    perform private.kc_raise('invalid_dice');
  end if;

  v_player := private.kc_turn_player(g, g.current_turn);
  if exists (select 1 from public.game_scores where game_id = g.id and player_id = v_player and category = p_category) then
    perform private.kc_raise('category_taken');
  end if;
  select points into v_kniffel from public.game_scores
  where game_id = g.id and player_id = v_player and category = 'kniffel';
  if v_extra and (p_category = 'kniffel' or v_kniffel is distinct from 50) then
    perform private.kc_raise('invalid_dice');
  end if;

  insert into public.game_scores (
    game_id, room_id, player_id, category, kind, points, dice, joker, strike_requested, kniffel_bonus, turn_no, created_by
  ) values (
    g.id, g.room_id, v_player, p_category,
    case when p_points = 0 then 'struck' else 'scored' end,
    p_points, '{}'::smallint[], v_extra and p_points > 0, p_points = 0,
    case when v_extra then 50 else 0 end, g.current_turn, v_user
  );

  update public.games set current_turn = current_turn + 1, version = version + 1
  where id = g.id returning * into g;

  perform private.kc_log(g.id, g.room_id, 'category_scored', jsonb_build_object(
    'turn_no', p_turn_no, 'player_id', v_player, 'category', p_category, 'points', p_points,
    'kniffel_bonus', case when v_extra then 50 else 0 end, 'struck', p_points = 0, 'manual', true));
  return g;
end;
$$;

create or replace function public.correct_manual(
  p_game_id uuid,
  p_expected_version integer,
  p_player_id uuid,
  p_category text,
  p_points integer,
  p_extra_kniffel boolean,
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
  v_extra boolean := coalesce(p_extra_kniffel, false);
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
  if not private.kc_manual_valid(p_category, p_points) then
    perform private.kc_raise('invalid_dice');
  end if;
  -- Kniffel-Feld von 50 weg ändern, obwohl spätere Zusatz-Kniffel daran hängen → ablehnen.
  if p_category = 'kniffel' and p_points <> 50 and exists (
    select 1 from public.game_scores x
    where x.game_id = g.id and x.player_id = p_player_id and x.turn_no > s.turn_no and x.kniffel_bonus > 0
  ) then
    perform private.kc_raise('correction_conflict');
  end if;
  select points into v_kniffel from public.game_scores
  where game_id = g.id and player_id = p_player_id and category = 'kniffel' and turn_no < s.turn_no;
  if v_extra and (p_category = 'kniffel' or v_kniffel is distinct from 50) then
    perform private.kc_raise('invalid_dice');
  end if;

  insert into public.score_corrections (score_id, game_id, room_id, player_id, category, old_value, new_value, reason, created_by)
  values (
    s.id, g.id, g.room_id, p_player_id, p_category,
    jsonb_build_object('points', s.points, 'kind', s.kind, 'kniffel_bonus', s.kniffel_bonus),
    jsonb_build_object('points', p_points, 'kind', case when p_points = 0 then 'struck' else 'scored' end,
                       'kniffel_bonus', case when v_extra then 50 else 0 end),
    btrim(p_reason), v_user
  );
  update public.game_scores set
    points = p_points,
    kind = case when p_points = 0 then 'struck' else 'scored' end,
    joker = v_extra and p_points > 0,
    strike_requested = p_points = 0,
    kniffel_bonus = case when v_extra then 50 else 0 end,
    corrected_at = now(),
    correction_count = correction_count + 1
  where id = s.id;

  update public.games set version = version + 1 where id = g.id returning * into g;
  perform private.kc_log(g.id, g.room_id, 'score_corrected', jsonb_build_object(
    'player_id', p_player_id, 'category', p_category, 'old_points', s.points, 'new_points', p_points,
    'reason', btrim(p_reason), 'manual', true));
  return g;
end;
$$;

revoke execute on function private.kc_manual_valid(text, integer) from public, anon, authenticated;
revoke execute on function public.score_manual(uuid, integer, integer, text, integer, boolean) from public, anon;
revoke execute on function public.correct_manual(uuid, integer, uuid, text, integer, boolean, text) from public, anon;
grant execute on function public.score_manual(uuid, integer, integer, text, integer, boolean) to authenticated;
grant execute on function public.correct_manual(uuid, integer, uuid, text, integer, boolean, text) to authenticated;
