-- Kniffel Club – serverseitiges Regelwerk "kniffel-schmidt" v1
-- Spiegelt src/domain/rules/scoring.ts exakt; tests/db/rules-parity.test.ts vergleicht beide.
-- Quelle und Auslegung: docs/rules.md

create or replace function private.kc_assert_ruleset(p_ruleset_id text, p_ruleset_version integer)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_ruleset_id is distinct from 'kniffel-schmidt' or p_ruleset_version is distinct from 1 then
    perform private.kc_raise('unsupported_ruleset');
  end if;
end;
$$;

create or replace function private.kc_validate_dice(p_dice smallint[])
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_d smallint;
begin
  if p_dice is null or cardinality(p_dice) <> 5 or array_ndims(p_dice) <> 1 then
    perform private.kc_raise('invalid_dice');
  end if;
  foreach v_d in array p_dice loop
    if v_d is null or v_d < 1 or v_d > 6 then
      perform private.kc_raise('invalid_dice');
    end if;
  end loop;
end;
$$;

create or replace function private.kc_is_kniffel(p_dice smallint[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select cardinality(p_dice) = 5
     and p_dice[1] = p_dice[2] and p_dice[1] = p_dice[3]
     and p_dice[1] = p_dice[4] and p_dice[1] = p_dice[5];
$$;

create or replace function private.kc_max_score(p_category text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  return case p_category
    when 'ones' then 5
    when 'twos' then 10
    when 'threes' then 15
    when 'fours' then 20
    when 'fives' then 25
    when 'sixes' then 30
    when 'three_kind' then 30
    when 'four_kind' then 30
    when 'full_house' then 25
    when 'small_straight' then 30
    when 'large_straight' then 40
    when 'kniffel' then 50
    when 'chance' then 30
  end;
end;
$$;

create or replace function private.kc_base_score(p_dice smallint[], p_category text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  c integer[] := array[0, 0, 0, 0, 0, 0];
  v_d smallint;
  v_sum integer := 0;
  v_max integer := 0;
  i integer;
begin
  perform private.kc_validate_dice(p_dice);
  foreach v_d in array p_dice loop
    c[v_d] := c[v_d] + 1;
    v_sum := v_sum + v_d;
  end loop;
  for i in 1..6 loop
    if c[i] > v_max then v_max := c[i]; end if;
  end loop;

  case p_category
    when 'ones' then return c[1] * 1;
    when 'twos' then return c[2] * 2;
    when 'threes' then return c[3] * 3;
    when 'fours' then return c[4] * 4;
    when 'fives' then return c[5] * 5;
    when 'sixes' then return c[6] * 6;
    when 'three_kind' then return case when v_max >= 3 then v_sum else 0 end;
    when 'four_kind' then return case when v_max >= 4 then v_sum else 0 end;
    -- Ein Kniffel zählt ohne Joker nicht als Full House (kniffelCountsAsFullHouse = false).
    when 'full_house' then return case when 3 = any (c) and 2 = any (c) then 25 else 0 end;
    when 'small_straight' then
      return case when (c[1] > 0 and c[2] > 0 and c[3] > 0 and c[4] > 0)
                    or (c[2] > 0 and c[3] > 0 and c[4] > 0 and c[5] > 0)
                    or (c[3] > 0 and c[4] > 0 and c[5] > 0 and c[6] > 0)
                  then 30 else 0 end;
    when 'large_straight' then
      return case when (c[1] > 0 and c[2] > 0 and c[3] > 0 and c[4] > 0 and c[5] > 0)
                    or (c[2] > 0 and c[3] > 0 and c[4] > 0 and c[5] > 0 and c[6] > 0)
                  then 40 else 0 end;
    when 'kniffel' then return case when v_max = 5 then 50 else 0 end;
    when 'chance' then return v_sum;
    else
      perform private.kc_raise('invalid_category');
  end case;
  return null;
end;
$$;

-- Wertung inkl. Zusatz-Kniffel und Joker.
-- p_kniffel_points: Punkte im Kniffel-Feld des Spielers (NULL = Feld noch offen).
create or replace function private.kc_evaluate(
  p_dice smallint[],
  p_category text,
  p_kniffel_points integer,
  p_strike boolean,
  out points integer,
  out joker boolean,
  out kniffel_bonus integer
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_base integer;
  v_extra boolean;
begin
  v_base := private.kc_base_score(p_dice, p_category);
  v_extra := private.kc_is_kniffel(p_dice) and p_kniffel_points is not distinct from 50 and p_category <> 'kniffel';
  kniffel_bonus := case when v_extra then 50 else 0 end;
  if p_strike then
    points := 0;
    joker := false;
  elsif v_extra then
    points := greatest(v_base, private.kc_max_score(p_category));
    joker := points > v_base;
  else
    points := v_base;
    joker := false;
  end if;
end;
$$;

-- Summen eines Spielers in einer Partie.
create or replace function private.kc_totals(p_game_id uuid, p_player_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with s as (
    select category, points, kniffel_bonus
    from public.game_scores
    where game_id = p_game_id and player_id = p_player_id
  ), agg as (
    select
      coalesce(sum(points) filter (where category in ('ones', 'twos', 'threes', 'fours', 'fives', 'sixes')), 0)::int as upper_subtotal,
      coalesce(sum(points) filter (where category not in ('ones', 'twos', 'threes', 'fours', 'fives', 'sixes')), 0)::int as lower_total,
      coalesce(sum(kniffel_bonus), 0)::int as extra_bonus,
      count(*)::int as filled
    from s
  )
  select jsonb_build_object(
    'upper_subtotal', upper_subtotal,
    'upper_bonus', case when upper_subtotal >= 63 then 35 else 0 end,
    'lower_total', lower_total,
    'extra_kniffel_bonus', extra_bonus,
    'filled', filled,
    'total', upper_subtotal + (case when upper_subtotal >= 63 then 35 else 0 end) + lower_total + extra_bonus
  )
  from agg;
$$;
