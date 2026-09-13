import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME, ROOT } from './pw.mjs';
const b=await chromium.launch({executablePath:CHROME});
const R=[]; const ok=(n,c,x)=>{R.push([n,c]);console.log((c?'OK   ':'FAIL ')+n+(x?' :: '+x:''));};
const SEED={birthDate: '1990-06-15', sex:'male',age:30,height:180,weight:82,activity:1.55,goal:'cut',meals:4,daysPerWeek:3,
  activePlan:{programId:'fullbody',days:3}};

// A. Модалка раціону: focus trap, Escape, повернення фокуса, aria
{
 const ctx=await adultContext(b, {viewport:{width:1100,height:900}}); const p=await ctx.newPage();
 await p.goto(`file://${ROOT}/meals.html`);
 await p.waitForTimeout(500);
 await p.evaluate(async s=>{await window.Store.saveProfile(s);},SEED);
 await p.reload(); await p.waitForTimeout(900);
 await p.locator('[data-add-to="0"]').first().click(); await p.waitForTimeout(200);
 await p.locator('#d-quick').fill('курка'); await p.waitForTimeout(400);
 await p.locator('.quick-list__item').first().click(); await p.waitForTimeout(400);
 const box=p.locator('.modal__box');
 ok('модалка: role=dialog + aria-modal', await box.getAttribute('role')==='dialog' && await box.getAttribute('aria-modal')==='true');
 ok('модалка: має доступну назву', !!(await box.getAttribute('aria-labelledby')));
 // Tab по колу — фокус не має вийти за межі
 let outside=false;
 for(let i=0;i<25;i++){ await p.keyboard.press('Tab');
   if(!(await p.evaluate(()=>!!document.activeElement.closest('.modal__box')))) {outside=true;break;} }
 ok('модалка: фокус не виходить за межі (25 Tab)', !outside);
 await p.keyboard.press('Escape'); await p.waitForTimeout(300);
 ok('модалка: Escape закриває', await p.locator('#modal').isHidden());
 ok('модалка: фокус повернувся у сторінку', await p.evaluate(()=>document.activeElement!==document.body));
 await ctx.close();
}

// B. Мобільне меню
{
 const ctx=await adultContext(b, {viewport:{width:390,height:844}}); const p=await ctx.newPage();
 await p.goto(`file://${ROOT}/index.html`); await p.waitForTimeout(700);
 await p.locator('.nav__burger').click(); await p.waitForTimeout(300);
 ok('меню: aria-expanded=true після відкриття', await p.locator('.nav__burger').getAttribute('aria-expanded')==='true');
 await p.keyboard.press('Escape'); await p.waitForTimeout(300);
 ok('меню: Escape закриває', await p.locator('.nav__burger').getAttribute('aria-expanded')==='false');
 ok('меню: фокус повернувся на бургер', await p.evaluate(()=>document.activeElement.classList.contains('nav__burger')));
 await ctx.close();
}

// C. Доступні назви інтерактивних елементів + aria-pressed на шкалах
{
 const ctx=await adultContext(b, {viewport:{width:1100,height:900}}); const p=await ctx.newPage();
 await p.goto(`file://${ROOT}/index.html`);
 await p.waitForTimeout(500);
 await p.evaluate(async s=>{await window.Store.saveProfile(Object.assign({},s,{trackers:{
   mood:{id:'mood',type:'mood',name:'Настрій',enabled:true,settings:{},goal:null,source:null,order:2,createdAt:null}}}));},SEED);
 /* Шкали 1..10 живуть КУБИКОМ НА ГОЛОВНІЙ: окрема сторінка вводу
    прибрана, «Трекери» стали налаштуваннями. Закріплюємо кубик явно —
    типово на головній не стоїть жоден. */
 await p.evaluate(async () => {
   const T = window.TrackerCore;
   const tr = T.setPinned(T.ensureBuiltins({}), 'mood', true);
   try { await window.Store.saveProfile({ trackers: tr }); } catch (e) { if (!e.queued) throw e; }
 });
 await p.goto(`file://${ROOT}/index.html`); await p.waitForTimeout(1300);
 const noName=await p.evaluate(()=>{
   const out=[];
   document.querySelectorAll('button, input, select, a[href]').forEach(el=>{
     const t=(el.textContent||'').trim();
     const name=el.getAttribute('aria-label')||el.getAttribute('title')||t||
       (el.labels&&el.labels.length?el.labels[0].textContent.trim():'')||
       (el.getAttribute('aria-labelledby')?'byid':'');
     if(!name) out.push(el.tagName+'.'+(el.className||'').toString().slice(0,40));
   });
   return out;
 });
 ok('усі кнопки/поля/посилання мають доступну назву', noName.length===0, noName.join(' | '));
 /* Шкала кубика: та сама розмітка, що була на прибраній сторінці, —
    змінився лише клас (.twt__scale замість .qi-scale). */
 const scale=p.locator('.twt__scale [data-trk-scale]').first();
 ok('кнопки шкали 1..10 мають aria-pressed', (await scale.getAttribute('aria-pressed'))!==null);
 const grp=p.locator('.twt__scale').first();
 ok('шкала має role=group з назвою', await grp.getAttribute('role')==='group' && !!(await grp.getAttribute('aria-label')));
 // фокус видимий
 const fv=await p.evaluate(()=>{const s=getComputedStyle(document.documentElement);return true;});
 await ctx.close();
}

// D. Тости оголошуються
{
 const ctx=await adultContext(b); const p=await ctx.newPage();
 await p.goto(`file://${ROOT}/index.html`); await p.waitForTimeout(700);
 await p.evaluate(()=>window.App.toast('тест','ok')); await p.waitForTimeout(200);
 const t=p.locator('.toasts');
 ok('контейнер тостів має role=status + aria-live', await t.getAttribute('role')==='status' && await t.getAttribute('aria-live')==='polite');
 await ctx.close();
}

/* E. Закрите мобільне меню має бути НЕВИДИМИМ і для дотику, і для Tab.
   Ховалось лише прозорістю, а .nav__drop ще й повертав pointer-events:auto —
   невидима накладка на 770 із 844 пікселів ловила дотики по сторінці:
   тап по кнопці внизу «Раціону» відкривав калькулятор 1ПМ. */
{
 const ctx=await adultContext(b, {viewport:{width:390,height:844}}); const p=await ctx.newPage();
 await p.goto(`file://${ROOT}/meals.html`); await p.waitForTimeout(900);
 const before=p.url();
 await p.mouse.click(195, 780);
 await p.waitForTimeout(600);
 ok('закрите меню не перехоплює дотик по сторінці', p.url()===before, p.url().split('/').pop());

 await p.goto(`file://${ROOT}/meals.html`); await p.waitForTimeout(800);
 let inMenu=0;
 for(let i=0;i<8;i++){ await p.keyboard.press('Tab');
   if(await p.evaluate(()=>{const a=document.activeElement;return !!(a.closest&&a.closest('.nav__links'));})) inMenu++; }
 ok('Tab не ходить крізь закрите меню', inMenu===0, 'потрапив у меню '+inMenu+' разів');

 await p.locator('.nav__burger').click(); await p.waitForTimeout(500);
 ok('відкрите меню видиме', await p.locator('.nav__links').evaluate(e=>getComputedStyle(e).visibility)==='visible');
 await p.locator('.nav__links a[href="boxing.html"]').scrollIntoViewIfNeeded();
 await p.locator('.nav__links a[href="boxing.html"]').click({timeout:5000});
 await p.waitForTimeout(700);
 ok('пункт із випадної групи працює в мобільному меню', p.url().includes('boxing'), p.url().split('/').pop());
 await ctx.close();
}
{
 const ctx=await adultContext(b, {viewport:{width:1280,height:900}}); const p=await ctx.newPage();
 await p.goto(`file://${ROOT}/index.html`); await p.waitForTimeout(800);
 /* Групу знаходимо за вмістом, а не за позицією: «Бокс» переїхав із
    групи-кнопки «Інше» під «Тренування», у якої є власна сторінка, тому
    перемикачем там служить стрілка, а не сам заголовок. */
 const grp = p.locator('.nav__item', { has: p.locator('a[href="boxing.html"]') }).first();
 const toggle = grp.locator('.nav__caret, .nav__link--parent').first();
 await toggle.click({timeout:5000}); await p.waitForTimeout(400);
 await grp.locator('.nav__drop a[href="boxing.html"]').click({timeout:5000});
 await p.waitForTimeout(700);
 ok('десктоп: пункт із випадної групи працює', p.url().includes('boxing'), p.url().split('/').pop());
 await ctx.close();
}

/* ==================================================================== */
/* D. Рейтинг, сезони й нагороди — найскладніші за розміткою екрани      */
/* ==================================================================== */
/*
 * ЧОМУ ЦЕЙ БЛОК ЗʼЯВИВСЯ (аудит 13.09.2026). Досі перевірка доступності
 * ходила рівно по двох сторінках — index.html і meals.html. А найважча
 * розмітка в проєкті саме тут: три екрани, які МАЛЮЄ JavaScript із
 * серверних даних, з акордеонами, картками-посиланнями й сіткою нагород.
 * Тобто те, що ламається найлегше, не перевірялось жодного разу.
 *
 * Сервер підроблений тим самим прийомом, що в verifyseasons.mjs:
 * window.Store перехоплюється в момент присвоєння. Без нього сторінка
 * рейтингу показує замок, і перевіряти було б нічого.
 */
{
  const CFGJ = JSON.parse((await import('node:fs')).readFileSync(ROOT + '/db/elo-config.json', 'utf8'));
  const day = (shift) => { const d = new Date(); d.setDate(d.getDate() - shift);
    return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); };
  const FAKE = {
    state: { season: 'AUTUMN-2026', elo: 412, today: 7, graceUsed: 1, graceUntil: null,
             rank: 3, of: 40, config: CFGJ },
    events: [
      { day: day(0), category: 'training', delta: 5, reason: 'Тренування закрито', eloAfter: 412 },
      { day: day(1), category: 'penalty', delta: -12, reason: 'Недобір тижня', eloAfter: 0 },
      { day: day(3), category: 'bonus', delta: 6, reason: 'Чистий день', eloAfter: 401 }
    ],
    history: [{ season: 'SUMMER-2026', elo: 2100, level: 10, elite: true, rank: 1, of: 50,
                percentile: 2, daysActive: 80, daysTotal: 92, graceUsed: 0,
                stats: { training: { events: 40, elo: 700, avgQuality: 0.82 },
                         biggestGain: 24, biggestLoss: -18, bestCategory: 'training' } }],
    awards: [{ season: 'SUMMER-2026', kind: 'first' }, { season: 'SUMMER-2026', kind: 'elite' }]
  };

  const ctx = await adultContext(b, { viewport: { width: 1100, height: 1000 } });
  await ctx.addInitScript((f) => {
    let s;
    Object.defineProperty(window, 'Store', {
      configurable: true,
      get: function () { return s; },
      set: function (nv) {
        s = nv;
        if (!s || s.__faked) return;
        s.__faked = true;
        s.isCloud = true;
        s.user = function () { return { id: 'a11y', email: 'a@e.t' }; };
        s.accountCached = function () { return { username: 'A11Y', status: 'approved' }; };
        s.rpc = async function (name) {
          if (name === 'elo_state') return f.state;
          if (name === 'elo_recent') return f.events;
          if (name === 'elo_history') return { history: f.history, awards: f.awards };
          if (name === 'elo_leaderboard') return [{ rank: 1, name: 'ANNA', elo: 980 }];
          return null;
        };
      }
    });
  }, FAKE);

  for (const page of ['rating.html', 'seasons.html', 'awards.html']) {
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`file://${ROOT}/${page}`, { waitUntil: 'load' });
    await p.waitForTimeout(1800);
    const tag = page.replace('.html', '');

    /* 1. Заголовки. Один h1 і жодного перестрибу рівня: читалка ходить по
       них як по змісту, і пропущений рівень читається як загублений розділ. */
    const heads = await p.$$eval('h1,h2,h3,h4,h5,h6',
      (n) => n.filter((x) => x.offsetParent !== null || x.tagName === 'H1')
              .map((x) => ({ lvl: Number(x.tagName[1]), text: (x.textContent || '').trim().slice(0, 40) })));
    const h1s = heads.filter((h) => h.lvl === 1);
    ok(tag + ': рівно один h1, і він не порожній',
      h1s.length === 1 && h1s[0].text.length > 0, h1s.map((h) => h.text).join(' | ') || 'немає');
    let jump = null;
    for (let i = 1; i < heads.length; i++) {
      if (heads[i].lvl - heads[i - 1].lvl > 1) { jump = heads[i - 1].text + ' → ' + heads[i].text; break; }
    }
    ok(tag + ': рівні заголовків не перестрибують', jump === null, jump || 'рівно');

    /* 2. Кожен елемент керування має доступне імʼя. Кнопка без імені для
       читалки — просто «кнопка»: що вона робить, дізнатись нізвідки. */
    const nameless = await p.$$eval('button, a[href], input, select, [tabindex]', (nodes) => {
      const named = (el) => {
        const t = (el.getAttribute('aria-label') || '').trim();
        if (t) return true;
        if (el.getAttribute('aria-labelledby')) return true;
        if ((el.textContent || '').trim()) return true;
        if (el.getAttribute('title')) return true;
        if (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) return true;
        if (el.closest('label')) return true;
        return false;
      };
      return nodes.filter((el) => el.offsetParent !== null && !named(el))
                  .map((el) => el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''));
    });
    ok(tag + ': у кожного елемента керування є доступне імʼя',
      nameless.length === 0, [...new Set(nameless)].join(', '));

    /* 3. tabindex > 0 ламає порядок обходу всієї сторінки, а не лише свій. */
    const positive = await p.$$eval('[tabindex]',
      (n) => n.map((x) => Number(x.getAttribute('tabindex'))).filter((v) => v > 0));
    ok(tag + ': жодного tabindex більше за нуль', positive.length === 0, positive.join(','));

    /* 4. Малюнок без підпису мусить бути схований від читалки: інакше вона
       читає «graphic» посеред речення й людина не розуміє, що сталось. */
    const loudSvg = await p.$$eval('svg', (n) => n.filter((x) =>
      x.getAttribute('aria-hidden') !== 'true' &&
      !x.getAttribute('aria-label') &&
      x.getAttribute('role') !== 'img' &&
      !x.closest('[aria-hidden="true"]')).length);
    ok(tag + ': декоративна графіка схована від читалки', loudSvg === 0, String(loudSvg));

    /* 5. Перший Tab має потрапити на «До вмісту»: без нього людина з
       клавіатури щоразу проходить усю навігацію, щоб дійти до тексту. */
    await p.keyboard.press('Tab');
    const skip = await p.evaluate(() => {
      const a = document.activeElement;
      return { cls: a && a.className, href: a && a.getAttribute && a.getAttribute('href') };
    });
    ok(tag + ': перший Tab — на «До вмісту»',
      String(skip.cls || '').includes('skip-link') && skip.href === '#main',
      JSON.stringify(skip));

    /* 6. Згорнутий акордеон мусить зникати і з таб-порядку теж — інакше
       табуляція заходить у невидиме, а читалка озвучує згорнуте. */
    const acc = await p.evaluate(() => {
      const closed = [...document.querySelectorAll('.acc:not(.is-open)')];
      if (!closed.length) return null;
      return closed.map((a) => {
        const head = a.querySelector('.acc__head');
        const inner = a.querySelector('.acc__inner');
        return {
          expanded: head && head.getAttribute('aria-expanded'),
          controls: !!(head && head.getAttribute('aria-controls')),
          inert: !!(inner && inner.hasAttribute('inert'))
        };
      });
    });
    ok(tag + ': згорнутий акордеон недосяжний для клавіатури й читалки',
      acc === null || acc.every((a) => a.expanded === 'false' && a.controls && a.inert),
      JSON.stringify(acc));

    ok(tag + ': без JS-помилок', errs.length === 0, errs.join(' | '));
    await p.close();
  }
  await ctx.close();
}

await b.close();
const bad=R.filter(r=>!r[1]);
console.log('\n'+(R.length-bad.length)+'/'+R.length+' перевірок доступності пройшло.');
process.exit(bad.length?1:0);
