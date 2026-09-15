-- =============================================================================
--  ВІДКАТ db/elo-recount-category.sql
-- =============================================================================
--
--  Прибирає перерахунок сезону й повертає elo_cfg_for до самодостатнього
--  вигляду (без elo_cfg_apply). Сам вимикач категорій при цьому лишається
--  чинним — відкочується тільки ретроактивний перерахунок.
--
--  ЩО ЛИШИТЬСЯ В ДАНИХ. Рядки 'admin:cat-recount:%' у журналі нікуди не
--  дінуться, і це навмисно: вони вже враховані в season_state.elo, і
--  видалити їх означало б розвести стан із журналом — рівно та біда, від
--  якої цей проєкт бережеться найдужче (DB-006).
-- =============================================================================

drop function if exists public.elo_recount_categories();
drop function if exists public.elo_event_delta(jsonb, text, numeric, numeric, int);

create or replace function public.elo_cfg_for(uid uuid, cfg jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  raw jsonb;
  skip text[];
  keys text[];
  total numeric := 0;
  w jsonb := '{}'::jsonb;
  k text;
begin
  if cfg is null or cfg->'weights' is null then return cfg; end if;

  select coalesce((select p.data->'eloSkip' from profiles p where p.user_id = uid), '[]'::jsonb)
    into raw;
  if jsonb_typeof(raw) is distinct from 'array' then return cfg; end if;

  select array_agg(x) into skip from jsonb_array_elements_text(raw) x;
  if skip is null or array_length(skip, 1) is null then return cfg; end if;

  select array_agg(x) into keys
    from jsonb_object_keys(cfg->'weights') x where not (x = any (skip));
  if keys is null or array_length(keys, 1) is null then return cfg; end if;
  if array_length(keys, 1) = (select count(*) from jsonb_object_keys(cfg->'weights')) then
    return cfg;
  end if;

  foreach k in array keys loop
    total := total + coalesce((cfg#>>array['weights', k])::numeric, 0);
  end loop;
  if total <= 0 then return cfg; end if;

  foreach k in array keys loop
    w := w || jsonb_build_object(k,
      round(coalesce((cfg#>>array['weights', k])::numeric, 0) / total, 6));
  end loop;
  return jsonb_set(cfg, '{weights}', w);
end $$;

revoke all on function public.elo_cfg_for(uuid, jsonb) from public;
grant execute on function public.elo_cfg_for(uuid, jsonb) to service_role;

drop function if exists public.elo_cfg_apply(jsonb, text[]);
