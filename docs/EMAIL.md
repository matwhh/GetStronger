# Листи автентифікації

## Хто їх насправді надсилає

**Brevo** (колишній Sendinblue), підключений до Supabase як власний SMTP.

Як це видно без доступу до дашборду — з самого листа:

```
From:        edukey.gm@12049186.brevosend.com
Sending IP:  77.32.148.28
Посилання:   https://bcaejbig.r.af.d.sendibt2.com/tr/cl/…
```

`brevosend.com` — спільний домен відправки Brevo, `12049186` — номер
акаунта; `sendibt2.com` / `sendibt3.com` — домени їхнього лічильника
кліків. Акаунт Brevo зареєстрований на **edukey.gm@gmail.com**.

Що з цього випливає:

- ліміт листів у проєкті **30/год**, а не 2/год — це ознака власного
  SMTP (вбудована пошта Supabase дає 2);
- відправник виглядає як `edukey.gm@12049186.brevosend.com` — адреса, за
  якою нічого не впізнати;
- **посилання з листів загорнуті в лічильник кліків Brevo**, і це не
  косметика (див. нижче).

## Три речі, які варто змінити

### 1. Вимкнути лічильник кліків — це не косметика

Brevo підміняє кожне посилання своїм і рахує переходи. Для розсилки це
нормально, для листів автентифікації — ні: посилання тут **одноразове**.
Антивірусні сканери пошти (корпоративні фільтри, деякі поштові клієнти)
відкривають посилання самі, щоб перевірити їх, — і спалюють токен ще до
того, як людина його побачить. Людина клікає й отримує «посилання вже
використане».

Де: **Brevo → Transactional → Settings → Tracking → Click tracking → Off**
(для транзакційних листів; на розсилки це не впливає).

### 2. Відправник

Зараз ім’я відправника — «Forge», адреса — технічна.

Де: **Supabase → Project → Authentication → Emails → SMTP Settings**

- `Sender name`: `Get Stronger`
- `Sender email`: краще власний домен. Поки домену немає, лишається
  адреса Brevo — але ім’я вже буде правильним.

Якщо колись буде свій домен: **Brevo → Senders, Domains & Dedicated IPs
→ Domains → Add a domain**, далі DKIM/SPF-записи, і після перевірки
адресу можна поставити, наприклад, `noreply@get-stronger.app`.

### 3. Тексти — українською

Шаблони нижче. Де: **Supabase → Authentication → Emails → Templates**,
кожен у своїй вкладці.

Змінні Supabase, які тут використані:

| Змінна | Що це |
| --- | --- |
| `{{ .ConfirmationURL }}` | готове посилання з токеном і redirect_to |
| `{{ .Email }}` | адреса, на яку надіслано лист |
| `{{ .SiteURL }}` | адреса сайту з налаштувань проєкту |

Розмітка навмисно проста: таблиць немає, картинок немає, шрифти
системні. Це не бідність, а прохідність — листи з картинками й
зовнішніми стилями частіше падають у «Спам», а в темній темі поштових
клієнтів складне оформлення розсипається.

---

### Confirm signup

**Subject:** `Підтвердіть пошту — Get Stronger`

```html
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:16px;line-height:1.55;color:#111;max-width:520px;margin:0 auto;padding:24px">
  <p style="font-size:22px;font-weight:800;letter-spacing:-0.01em;margin:0 0 20px">GET STRONGER</p>

  <p style="margin:0 0 16px">Вітаємо. Лишився один крок: підтвердіть, що ця пошта ваша.</p>

  <p style="margin:0 0 28px">
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:14px 26px;border-radius:10px;font-weight:600">Підтвердити пошту</a>
  </p>

  <p style="margin:0 0 16px;color:#555;font-size:14px">
    Відкривайте посилання в тому самому браузері, з якого реєструвались.
    Якщо читаєте лист у застосунку пошти на телефоні — нічого страшного:
    сайт спитає, чи це ваша адреса, і покаже її.
  </p>

  <p style="margin:0 0 16px;color:#555;font-size:14px">
    Посилання одноразове й діє добу. Якщо не спрацювало — не шукайте цей
    лист удруге, замовте новий на сайті.
  </p>

  <p style="margin:0;color:#888;font-size:13px">
    Якщо ви не реєструвались у Get Stronger — просто видаліть цей лист.
    Без підтвердження акаунт нічого не робить і за тиждень зникає сам.
  </p>
</div>
```

---

### Reset password

**Subject:** `Новий пароль — Get Stronger`

```html
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:16px;line-height:1.55;color:#111;max-width:520px;margin:0 auto;padding:24px">
  <p style="font-size:22px;font-weight:800;letter-spacing:-0.01em;margin:0 0 20px">GET STRONGER</p>

  <p style="margin:0 0 16px">Ви попросили змінити пароль до акаунта <b>{{ .Email }}</b>.</p>

  <p style="margin:0 0 28px">
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:14px 26px;border-radius:10px;font-weight:600">Поставити новий пароль</a>
  </p>

  <p style="margin:0 0 16px;color:#555;font-size:14px">
    Старий пароль ми не знаємо й надіслати не можемо — ви просто
    введете новий на сайті.
  </p>

  <p style="margin:0 0 16px;color:#555;font-size:14px">
    Посилання одноразове й діє добу. Якщо воно не спрацювало, замовте
    новий лист: на екрані помилки для цього є кнопка.
  </p>

  <p style="margin:0;color:#888;font-size:13px">
    Якщо ви цього не просили — нічого робити не треба. Пароль лишиться
    старим, доки ніхто не відкриє це посилання.
  </p>
</div>
```

---

### Magic Link

**Subject:** `Вхід у Get Stronger`

```html
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:16px;line-height:1.55;color:#111;max-width:520px;margin:0 auto;padding:24px">
  <p style="font-size:22px;font-weight:800;letter-spacing:-0.01em;margin:0 0 20px">GET STRONGER</p>

  <p style="margin:0 0 16px">Посилання для входу без пароля:</p>

  <p style="margin:0 0 28px">
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:14px 26px;border-radius:10px;font-weight:600">Увійти</a>
  </p>

  <p style="margin:0;color:#888;font-size:13px">
    Одноразове, діє добу. Якщо ви не просили — видаліть лист: поки
    посилання не відкрито, нічого не сталося.
  </p>
</div>
```

---

### Change Email Address

**Subject:** `Підтвердіть нову пошту — Get Stronger`

```html
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:16px;line-height:1.55;color:#111;max-width:520px;margin:0 auto;padding:24px">
  <p style="font-size:22px;font-weight:800;letter-spacing:-0.01em;margin:0 0 20px">GET STRONGER</p>

  <p style="margin:0 0 16px">Ви міняєте пошту акаунта на <b>{{ .Email }}</b>. Підтвердіть, що вона ваша:</p>

  <p style="margin:0 0 28px">
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:14px 26px;border-radius:10px;font-weight:600">Підтвердити нову пошту</a>
  </p>

  <p style="margin:0;color:#888;font-size:13px">
    Доки посилання не відкрито, вхід працює зі старою адресою.
  </p>
</div>
```

---

## Як перевірити, що вийшло

Не на власній пошті: Gmail показує свої ж листи поблажливо.

1. Зайдіть на <https://www.mailinator.com> і придумайте будь-яку адресу
   виду `щось@mailinator.com` — скринька публічна й створюється сама.
2. Зареєструйтесь на сайті з цією адресою.
3. Відкрийте скриньку на mailinator і подивіться: ім’я відправника,
   мову тексту, і — головне — куди веде посилання (вкладка `LINKS`).
   Якщо воно веде прямо на `forge-mold1.vercel.app`, а не на
   `sendibt2.com`, лічильник кліків вимкнено правильно.
4. Пройдіть по посиланню до кінця.
5. Приберіть тестовий акаунт із бази — або лишіть: незавершені
   реєстрації прибирає щодобове завдання `purge_abandoned_signups`
   (див. `db/purge-abandoned-signups.sql`).
