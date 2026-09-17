-- =============================================================================
-- АКАУНТ БЕЗ ЗАЯВКИ БІЛЬШЕ НЕ ПОТРАПЛЯЄ В РЕЙТИНГ  (аудит 2026-09-17)
-- =============================================================================
-- Міграція: admin_elo_approved_only_and_purge_never_applied
--
-- ЯК ЦЕ ВИГЛЯДАЛО. В адмінці, на вкладці ELO, стояли рядки з поштами, яких
-- не було у «Заявках» ЖОДНОГО разу — з полем і кнопкою «Поставити». Тобто
-- людині, про яку адмін не приймав жодного рішення, можна було нарахувати
-- рейтинг.
--
-- ЧОМУ. Дірка складалась із трьох частин, і кожна окремо виглядала
-- нешкідливо.
--
-- 1. admin_elo_list брала список ПРЯМО з auth.users:
--
--        from auth.users u
--        left join account_status ar on ar.user_id = u.id
--
--    LEFT JOIN означає «покажи всіх, а заявку додай, якщо є». У панель
--    потрапляв кожен, хто колись натиснув «Зареєструватись»: і той, хто
--    подався й чекає, і відхилений, і той, хто заявки не подавав узагалі.
--
-- 2. admin_elo_set перевіряв рівно одне — «чи є такий рядок в auth.users».
--    Натиснута кнопка заводила season_state, а звідти акаунт уже видно в
--    таблиці лідерів: без заявки, без рішення, без нічого. Барʼєр
--    NOT_APPROVED стоїть на всіх клієнтських RPC від серпня (INV-002) —
--    адмінський шлях його обходив.
--
-- 3. purge_abandoned_signups прибирала тільки тих, хто не підтвердив пошту
--    Й жодного разу не заходив. Людина, яка пошту підтвердила, зайшла й
--    заявки НЕ ПОДАЛА, лишалась у базі назавжди: рядка account_status у неї
--    немає, тож у «Заявках» її не видно, і прибирати її нічому.
--
-- Разом це давало акаунти-привиди: у «Заявках» порожньо, у рейтингу — є.
-- На 17.09.2026 таких було троє.
--
-- ЩО ЗМІНЕНО:
--   • admin_elo_list — JOIN замість LEFT JOIN, і тільки status='approved';
--   • admin_elo_set  — той самий барʼєр NOT_APPROVED, що й у клієнта;
--   • purge_abandoned_signups — друге правило: «немає ЖОДНОЇ заявки після
--     пільгового строку» теж означає незавершену реєстрацію. Рішення
--     адміна (pending / approved / rejected / blocked) завжди лишає рядок,
--     тож нікого, про кого вже думали, це не зачепить.
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
    select coalesce(ss.elo, 0) as elo,
           u.created_at as created_at,
           jsonb_build_object(
             'userId',   u.id,
             'email',    u.email,
             'username', coalesce(ss.display_name, ar.username),
             'elo',      coalesce(ss.elo, 0),
             'me',       (u.id = me)) as x
    from auth.users u
    /* JOIN, а не LEFT JOIN, і тільки approved: рейтинг існує лише в
       підтверджених акаунтів, тож показувати решту означає пропонувати
       адміну дію, якої робити не можна. */
    join account_status ar on ar.user_id = u.id and ar.status = 'approved'
    left join season_state ss on ss.user_id = u.id and ss.season = szn
    order by coalesce(ss.elo, 0) desc, u.created_at
    limit greatest(1, least(coalesce(p_limit, 200), 500))
  ) t;

  return jsonb_build_object('season', szn, 'rows', out);
end $$;

revoke all on function public.admin_elo_list(integer) from public, anon;
grant execute on function public.admin_elo_list(integer) to authenticated;

create or replace function public.admin_elo_set(p_user uuid, p_elo integer, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  szn text := season_of(current_date);
  cfg jsonb;
  st season_state;
  target int; diff int; note text;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.is_admin(me) then raise exception 'FORBIDDEN'; end if;
  if p_user is null then raise exception 'BAD_USER'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'NO_USER'; end if;
  /* Той самий барʼєр, що на клієнтських RPC. Без нього адмінська кнопка
     заводила season_state акаунту без заявки — і він ставав видимим у
     таблиці лідерів. */
  if not exists (select 1 from account_status a
                  where a.user_id = p_user and a.status = 'approved') then
    raise exception 'NOT_APPROVED';
  end if;
  select data into cfg from elo_config where id = 1;
  target := greatest(0, least(coalesce(p_elo, 0), (cfg->>'seasonMax')::int));
  insert into season_state (user_id, season) values (p_user, szn) on conflict do nothing;
  select * into st from season_state where user_id = p_user and season = szn for update;
  diff := target - st.elo;
  if diff = 0 then
    return jsonb_build_object('ok', true, 'elo', target, 'delta', 0, 'noop', true);
  end if;
  note := coalesce(nullif(btrim(p_reason), ''), 'Ручне виставлення (адмін)');
  update season_state
    set elo = target, updated_at = now()
  where user_id = p_user and season = szn;
  insert into elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
  values (p_user, szn, current_date, 'admin', 'admin',
          'admin:' || extract(epoch from clock_timestamp())::bigint || ':' || md5(random()::text),
          0, diff, target, note);
  return jsonb_build_object('ok', true, 'elo', target, 'delta', diff, 'season', szn);
end $$;

revoke all on function public.admin_elo_set(uuid, integer, text) from public, anon;
grant execute on function public.admin_elo_set(uuid, integer, text) to authenticated;

create or replace function public.purge_abandoned_signups(p_grace_days integer default 7)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cut   timestamptz := now() - make_interval(days => greatest(p_grace_days, 1));
  v_ids   uuid[];
  v_count integer := 0;
begin
  select coalesce(array_agg(u.id), '{}')
    into v_ids
    from auth.users u
   where u.created_at < v_cut
     and (
       /* Реєстрація не дійшла навіть до пошти. */
       (u.email_confirmed_at is null and u.last_sign_in_at is null)
       /* Або дійшла, але заявки не було ЖОДНОЇ: рядка account_status
          немає, тобто в «Заявках» цієї людини не існує. Рішення адміна
          (pending / approved / rejected / blocked) завжди лишає рядок,
          тож сюди не потрапляє ніхто, про кого вже думали. */
       or not exists (select 1 from public.account_status a where a.user_id = u.id)
     );

  v_count := coalesce(array_length(v_ids, 1), 0);
  if v_count = 0 then
    return jsonb_build_object('deleted', 0, 'cutoff', v_cut);
  end if;

  delete from public.elo_events     where user_id = any(v_ids);
  delete from public.elo_week_plan  where user_id = any(v_ids);
  delete from public.season_history where user_id = any(v_ids);
  delete from public.season_state   where user_id = any(v_ids);
  delete from public.awards         where user_id = any(v_ids);
  delete from public.consent_log    where user_id = any(v_ids);
  delete from public.account_status where user_id = any(v_ids);
  delete from public.profiles       where user_id = any(v_ids);
  delete from auth.users            where id      = any(v_ids);

  return jsonb_build_object('deleted', v_count, 'cutoff', v_cut);
end $$;

revoke all on function public.purge_abandoned_signups(integer) from public, anon, authenticated;
grant execute on function public.purge_abandoned_signups(integer) to service_role;
