-- =============================================================================
-- ВІДКАТ db/elo-skip-whitelist.sql
-- =============================================================================
-- Повертає elo_cfg_for, яка бере eloSkip як є, і прибирає ключ "skippable"
-- з конфігу.
--
-- УВАГА: після відкату клієнт знову може вимкнути будь-яку категорію
-- рейтингу, зокрема лишити в грі саму лише sleep — див. шапку міграції.
-- =============================================================================

create or replace function public.elo_cfg_for(uid uuid, cfg jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  raw jsonb;
  skip text[];
begin
  if cfg is null or cfg->'weights' is null then return cfg; end if;
  select coalesce((select p.data->'eloSkip' from profiles p where p.user_id = uid), '[]'::jsonb)
    into raw;
  if jsonb_typeof(raw) is distinct from 'array' then return cfg; end if;
  select array_agg(x) into skip from jsonb_array_elements_text(raw) x;
  return public.elo_cfg_apply(cfg, skip);
end $$;

revoke all on function public.elo_cfg_for(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.elo_cfg_for(uuid, jsonb) to service_role;

update public.elo_config set data = data - 'skippable' where id = 1;
