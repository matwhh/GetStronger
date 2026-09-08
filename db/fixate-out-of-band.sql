-- DB-010. Три обʼєкти бойової схеми були створені повз apply_migration, тому
-- в історії міграцій їх немає: на чистій базі вони б не зʼявились узагалі.
--
--   · CHECK elo_events_category_check — пошук по тілах усіх міграцій дає 0;
--   · cron.job 'forge-elo-week'       — cron.schedule не викликається в жодній
--     міграції; коментар db/cron.sql про «застосовано міграцією
--     elo_cron_eval_week» був хибним: та міграція створює ФУНКЦІЮ, не розклад;
--   · public.admin_elo_list(integer)  — теж лише в базі.
--
-- Ця міграція нічого не змінює в поведінці: вона фіксує вже наявний стан у
-- вигляді, який відтворюється. Тексти взято НЕ з памʼяті, а з бойової бази:
-- pg_get_constraintdef, cron.job і pg_get_functiondef (див. db/README.md —
-- саме переписування функції «як памʼятаю» коштувало найдорожче).
--
-- Ідемпотентна: повторний прогін лишає той самий стан.

-- 1. Перелік категорій події ELO -------------------------------------------
alter table public.elo_events drop constraint if exists elo_events_category_check;
alter table public.elo_events add constraint elo_events_category_check
  CHECK ((category = ANY (ARRAY['training'::text, 'nutrition'::text, 'sleep'::text,
                                'recovery'::text, 'activity'::text, 'penalty'::text,
                                'bonus'::text, 'admin'::text])));

-- 2. Розклад оцінки тижня ---------------------------------------------------
-- cron.schedule за наявним імʼям оновлює запис, а не плодить дублікати.
-- Команда — саме обгортка з журналом (elo_cron_log_eval_week), як у базі.
select cron.schedule('forge-elo-week', '10 0 * * *',
                     'select public.elo_cron_log_eval_week()');

-- 3. Список рейтингу для адміністратора -------------------------------------
CREATE OR REPLACE FUNCTION public.admin_elo_list(p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me uuid := auth.uid();
  szn text := season_of(current_date);
  out jsonb;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.is_admin(me) then raise exception 'FORBIDDEN'; end if;

  select coalesce(jsonb_agg(t.x order by t.elo desc, t.created_at), '[]'::jsonb) into out from (
    select coalesce(ss.elo, 0) as elo,
           u.created_at as created_at,
           jsonb_build_object(
             'userId',   u.id,
             'email',    u.email,
             'username', coalesce(ss.display_name, ar.username),
             'elo',      coalesce(ss.elo, 0),
             'me',       (u.id = me)) as x
    from auth.users u
    left join season_state ss on ss.user_id = u.id and ss.season = szn
    left join account_status ar on ar.user_id = u.id
    order by coalesce(ss.elo, 0) desc, u.created_at
    limit greatest(1, least(coalesce(p_limit, 200), 500))
  ) t;

  return jsonb_build_object('season', szn, 'rows', out);
end;
$function$;

revoke execute on function public.admin_elo_list(integer) from public;
grant execute on function public.admin_elo_list(integer) to authenticated;
grant execute on function public.admin_elo_list(integer) to service_role;
