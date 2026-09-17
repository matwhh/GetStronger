-- =============================================================================
-- ВІДКАТ db/account-hole.sql
-- =============================================================================
-- УВАГА: разом із відкотом повертаються акаунти-привиди — у панелі ELO
-- знову зʼявляться люди без заявки, і їм знову можна буде нарахувати
-- рейтинг. Відкочувати варто лише якщо щось піде не так із самим JOIN.
-- =============================================================================

create or replace function public.admin_elo_list(p_limit integer default 200)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  szn text := season_of(current_date);
  out jsonb;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.is_admin(me) then raise exception 'FORBIDDEN'; end if;
  select coalesce(jsonb_agg(t.x order by t.elo desc, t.created_at), '[]'::jsonb) into out from (
    select coalesce(ss.elo, 0) as elo, u.created_at as created_at,
           jsonb_build_object('userId', u.id, 'email', u.email,
             'username', coalesce(ss.display_name, ar.username),
             'elo', coalesce(ss.elo, 0), 'me', (u.id = me)) as x
    from auth.users u
    left join season_state ss on ss.user_id = u.id and ss.season = szn
    left join account_status ar on ar.user_id = u.id
    order by coalesce(ss.elo, 0) desc, u.created_at
    limit greatest(1, least(coalesce(p_limit, 200), 500))
  ) t;
  return jsonb_build_object('season', szn, 'rows', out);
end $$;

/* admin_elo_set без барʼєра NOT_APPROVED і purge без другого правила —
   їхні попередні тіла лежать у git: git show <коміт перед цим>:db/live-schema.sql */
