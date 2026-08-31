/**
 * Тема «Ліс»: срібні поверхні, зелений акцент, чорний текст.
 *
 * Єдина тема з ВЛАСНИМИ поверхнями, тому перевіряється не лише те, що
 * акцент змінився, а й що поверхні справді срібні в обох положеннях
 * перемикача, текст на них читається (виміряний контраст, а не «на око»)
 * і що тема стоїть ДО першого кадру — без блимання графіту.
 */
import { chromium } from 'playwright';
const ROOT = process.cwd();
const R=[]; const ok=(n,c,x)=>{R.push([n,c]);console.log((c?'OK   ':'FAIL ')+n+(x?' :: '+x:''));};
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

const rgb = s => (s.match(/\d+/g)||[]).slice(0,3).map(Number);
const lin = c => { c/=255; return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4); };
const L = a => 0.2126*lin(a[0])+0.7152*lin(a[1])+0.0722*lin(a[2]);
const ratio = (a,b)=>{const l1=L(a),l2=L(b);const hi=Math.max(l1,l2),lo=Math.min(l1,l2);return (hi+0.05)/(lo+0.05);};

const PROFILE = { version:10, sex:'male', birthDate:'1995-06-15', age:31, weight:82, height:180,
  activity:1.55, trainingAge:'inter', activePlan:{programId:'ppl',days:3}, programId:'ppl',
  weights:{'Жим лежачи':100} };

async function open(theme, scheme, page) {
  const ctx = await b.newContext({ viewport:{width:1200,height:950} });
  await ctx.addInitScript((a)=>{
    localStorage.setItem('ib.cloud','0');
    localStorage.setItem('ib.profile', JSON.stringify(a.p));
    if (a.t) localStorage.setItem('forge.theme', a.t);
    if (a.s === 'light') localStorage.setItem('forge.scheme','light');
  }, { p: PROFILE, t: theme, s: scheme });
  await ctx.route('**/*', r=>/fonts\.|google/.test(r.request().url())?r.abort():r.continue());
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('file://'+ROOT+'/'+(page||'index.html'),{waitUntil:'load'});
  await p.waitForTimeout(900);
  return { ctx, p, errs };
}

/* ---- 1. Поверхні, текст і акцент ---- */
{
  const { ctx, p, errs } = await open('forest', null);
  const v = await p.evaluate(()=>{
    const cs = getComputedStyle(document.documentElement);
    const g = n => cs.getPropertyValue(n).trim();
    return { theme: document.documentElement.dataset.theme,
      bg:g('--bg'), card:g('--card-1'), field:g('--field'),
      text:g('--text'), acc:g('--acc'), accInk:g('--acc-ink'), onAcc:g('--on-acc'),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      bodyColor: getComputedStyle(document.body).color,
      bar: (document.querySelector('meta[name=theme-color]')||{}).content };
  });
  ok('1. тема застосована', v.theme === 'forest', v.theme);
  ok('1. тло — срібло з палітри', v.bg.toLowerCase() === '#a7aaa8', v.bg);
  ok('1. акцент — зелень із палітри', v.acc.toLowerCase() === '#263d2b', v.acc);
  ok('1. текст — чорне з палітри', v.text.toLowerCase() === '#111312', v.text);
  ok('1. body реально срібний', ratio(rgb(v.bodyBg), [167,170,168]) < 1.06, v.bodyBg);
  ok('1. смуга браузера срібна', (v.bar||'').toLowerCase() === '#a7aaa8', v.bar);
  ok('1. без JS-помилок', errs.length===0, errs.join(' | '));
  await ctx.close();
}

/* ---- 2. Виміряний контраст на живих елементах ---- */
{
  const { ctx, p, errs } = await open('forest', null, 'account.html');
  const probe = await p.evaluate(()=>{
    const out = [];
    const push = (label, el) => {
      if (!el) return;
      let bg = 'rgba(0, 0, 0, 0)', n = el;
      while (n && bg === 'rgba(0, 0, 0, 0)') { bg = getComputedStyle(n).backgroundColor; n = n.parentElement; }
      out.push({ label, fg: getComputedStyle(el).color, bg });
    };
    push('заголовок', document.querySelector('h1'));
    push('текст картки', document.querySelector('.card p'));
    push('muted', document.querySelector('.muted, .small.muted'));
    push('посилання', document.querySelector('a.small, .card a'));
    const btn = document.querySelector('.btn--primary');
    if (btn) out.push({ label:'кнопка (текст на заливці)', fg:getComputedStyle(btn).color, bg:getComputedStyle(btn).backgroundColor });
    return out;
  });
  probe.forEach(x => {
    const r = Math.round(ratio(rgb(x.fg), rgb(x.bg))*100)/100;
    ok('2. контраст ' + x.label + ' ≥ 4.5', r >= 4.5, r + ':1');
  });
  ok('2. без JS-помилок', errs.length===0, errs.join(' | '));
  await ctx.close();
}

/* ---- 3. Світле положення перемикача — та сама тема, ясніша ---- */
{
  const { ctx, p, errs } = await open('forest', 'light');
  const v = await p.evaluate(()=>{
    const cs = getComputedStyle(document.documentElement);
    return { bg: cs.getPropertyValue('--bg').trim(), acc: cs.getPropertyValue('--acc').trim(),
             scheme: document.documentElement.dataset.scheme };
  });
  ok('3. світле положення: тло ясніше срібло', v.bg.toLowerCase() === '#b0b3b1', v.bg);
  ok('3. акцент не змінився', v.acc.toLowerCase() === '#263d2b', v.acc);
  ok('3. схема light активна', v.scheme === 'light');
  ok('3. без JS-помилок', errs.length===0, errs.join(' | '));
  await ctx.close();
}

/* ---- 4. Без блимання: тему ставить ІНЛАЙН-скрипт у <head> ---- */
{
  /* app.js навмисно заблоковано: якщо тема все одно стоїть, її поставив
     інлайн-гейт до першого кадру — саме це й прибирає блимання графіту. */
  const ctx = await b.newContext();
  await ctx.addInitScript(()=>{ localStorage.setItem('ib.cloud','0'); localStorage.setItem('forge.theme','forest'); });
  await ctx.route('**/*', r => (/js\/app\.js/.test(r.request().url()) || /fonts\.|google/.test(r.request().url()))
    ? r.abort() : r.continue());
  const p = await ctx.newPage();
  await p.goto('file://'+ROOT+'/index.html',{waitUntil:'domcontentloaded'});
  const v = await p.evaluate(()=>({
    theme: document.documentElement.dataset.theme || '',
    bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    bar: (document.querySelector('meta[name=theme-color]')||{}).content,
    appLoaded: !!window.App
  }));
  ok('4. app.js справді не завантажився', v.appLoaded === false, String(v.appLoaded));
  ok('4. тему поставив інлайн-гейт (без блимання)', v.theme === 'forest', v.theme || '(порожньо)');
  ok('4. срібло вже застосоване', v.bg.toLowerCase() === '#a7aaa8', v.bg);
  ok('4. смуга браузера вже срібна', (v.bar||'').toLowerCase() === '#a7aaa8', v.bar);
  await ctx.close();
}

/* ---- 5. Тема живе в перемикачі акаунта і перемикається ---- */
{
  const { ctx, p, errs } = await open(null, null, 'account.html');
  await p.waitForTimeout(400);
  const has = await p.locator('[data-theme-pick="forest"]').count();
  ok('5. плашка «Ліс» є в перемикачі', has === 1, String(has));
  await p.locator('[data-theme-pick="forest"]').click();
  await p.waitForTimeout(500);
  const after = await p.evaluate(()=>({
    theme: document.documentElement.dataset.theme,
    saved: localStorage.getItem('forge.theme'),
    bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    pressed: document.querySelector('[data-theme-pick="forest"]').getAttribute('aria-pressed')
  }));
  ok('5. клік застосував тему', after.theme === 'forest' && after.bg.toLowerCase() === '#a7aaa8', JSON.stringify(after));
  ok('5. вибір збережено', after.saved === 'forest', after.saved);
  ok('5. плашка позначена активною', after.pressed === 'true', after.pressed);
  ok('5. без JS-помилок', errs.length===0, errs.join(' | '));
  await ctx.close();
}

/* ---- 6. Решта тем не зачеплені ---- */
{
  const { ctx, p, errs } = await open('graphite-emerald', null);
  const v = await p.evaluate(()=>({
    bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    acc: getComputedStyle(document.documentElement).getPropertyValue('--acc').trim()
  }));
  ok('6. графітова тема лишилась темною', v.bg.toLowerCase() === '#0b0b0b', v.bg);
  ok('6. її акцент не підмінено', v.acc.toLowerCase() === '#1f835e', v.acc);
  ok('6. без JS-помилок', errs.length===0, errs.join(' | '));
  await ctx.close();
}

await b.close();
const bad=R.filter(r=>!r[1]).length;
console.log('\n'+(R.length-bad)+'/'+R.length+' перевірок теми «Ліс».');
process.exit(bad?1:0);
