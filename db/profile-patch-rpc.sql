-- PRF-006. Часткове збереження профілю для keepalive-запиту при закритті вкладки.
--
-- ЧОМУ ЦЕ ПОТРІБНО. Store.saveProfileBeacon шле весь профіль одним
-- upsert-ом: тілом запиту є ВСЕ, що людина накопичила. Ліміт keepalive —
-- 64 КБ; профіль перетинає 60 КБ приблизно після 40–60 записаних сесій,
-- тобто за один-два місяці. Далі гілка keepalive недосяжна назавжди:
-- кожен запис при закритті вкладки лягає в чергу й доїжджає лише при
-- наступному відкритті сайту. Дані не гинуть, але «зберігається одразу»
-- перестає бути правдою рівно для тих, хто користується довше за всіх.
--
-- Тілом цього виклику є ЛИШЕ патч — те, що змінилось. Для правок в
-- «Акаунті» це десятки байтів замість десятків кілобайтів.
--
-- БЕЗПЕКА. security invoker (за замовчуванням) — RLS лишається в силі:
-- і insert, і update проходять через ті самі політики profiles_*_own,
-- тобто вимагають auth.uid() = user_id і is_approved(). Жодних нових
-- прав тут не з'являється; функція лише економить трафік.
--
-- СЕМАНТИКА ЗЛИТТЯ. data || p_patch — поверхневе злиття верхнього рівня,
-- рівно те саме, що робить doSave у клієнті (Object.assign). Патч — це
-- ціле значення поля, а не глибокий дифф.

create or replace function public.profile_patch(p_patch jsonb)
returns void
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'BAD_PATCH';
  end if;

  insert into public.profiles (user_id, data)
  values (uid, p_patch)
  on conflict (user_id) do update
    set data = public.profiles.data || excluded.data;
end
$function$;

grant execute on function public.profile_patch(jsonb) to authenticated;
grant execute on function public.profile_patch(jsonb) to service_role;

-- Решта функцій public не мають виконання для PUBLIC (це право дає Postgres
-- за замовчуванням) — нова не має бути винятком. Окремою міграцією
-- profile_patch_revoke_public, бо в самому create його не відібрати.
revoke execute on function public.profile_patch(jsonb) from public;
