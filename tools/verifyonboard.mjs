/** Наскрізний шлях новачка: від чистого браузера до щоденного вжитку. */
import { chromium } from 'playwright';
import { fillBirth } from './dob.mjs';
import { localMode } from './adult.mjs';
import { CHROME, ROOT } from './pw.mjs';
const U=f=>`file://${ROOT}/`+f;
const b=await chromium.launch({executablePath:CHROME});
const R=[]; const ok=(n,c,x)=>{R.push([n,c]);console.log((c?'OK   ':'FAIL ')+n+(x?' :: '+x:''));};
/* Тут НЕ adultContext: це шлях новачка, і починатись він має рівно з
   того, з чого починає жива людина — з чистого браузера й онбордингу:
   вік → тіло → програма з робочою вагою. */
const ctx=await b.newContext({viewport:{width:390,height:844}});
/* Локальний режим: щасливий шлях новачка тут — саме профільний
   (вік → тіло → програма). У хмарному перед ним стоять реєстрація й
   схвалення заявки; вони перевіряються окремо, а тут упирались би в
   екран входу. localMode() гасить ключі Supabase до завантаження. */
await localMode(ctx);
await ctx.route(/^https?:\/\//, r => r.abort());
const p=await ctx.newPage(); const errs=[];
p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',d=>d.accept());
const tap=async l=>{await l.evaluate(e=>e.scrollIntoView({block:'center'})).catch(()=>{}); return l.click({timeout:5000});};
const here=()=>p.url().split('/').pop().split('#')[0];

// 0. Вік — перший і обовʼязковий крок
await p.goto(U('index.html'));
await p.evaluate(()=>localStorage.clear());
await p.reload(); await p.waitForTimeout(900);
ok('0. чистий браузер веде на перевірку віку', here()==='welcome.html', here());
/* Перший екран welcome — стартовий («Увійти» / «Зареєструватися»).
   Скринінг стоїть за «Зареєструватися»: у локальному режимі ця кнопка
   веде просто на крок 'age'. */
await p.locator('#gate-card [data-nav="age"]').click();
await p.waitForTimeout(400);
ok('0. кнопка вимкнена, поки дати немає', await p.locator('#gate-go').isDisabled());
await fillBirth(p, '1995-03-10'); await p.waitForTimeout(400);
ok('0. після дорослої дати можна далі', !(await p.locator('#gate-go').isDisabled()));
await tap(p.locator('#gate-go')); await p.waitForTimeout(1000);

// 1. Тіло — на тому самому екрані, без навігації
ok('1. далі одразу крок «тіло»', here()==='welcome.html' && await p.locator('#b-weight').count()===1);
ok('1. кнопка вимкнена, поки поля порожні', await p.locator('#body-go').isDisabled());
/* Спроба втекти вперед — сторож повертає на крок */
await p.goto(U('index.html')); await p.waitForTimeout(700);
ok('1. утеча на головну повертає на крок «тіло»', here()==='welcome.html', here());
/* Порядок полів: стать → вага → зріст → активність → стаж → пульси */
const fieldOrder = await p.evaluate(()=>[...document.querySelectorAll('#gate-card input:not([type=radio]), #gate-card select')].map(e=>e.id));
ok('1. порядок полів за специфікацією',
   JSON.stringify(fieldOrder)===JSON.stringify(['b-height','b-weight','b-activity','b-trainage','b-hrrest','b-hrmax']),
   fieldOrder.join(','));
ok('1. placeholder обох пульсів — «Необовʼязково»',
   (await p.locator('#b-hrmax').getAttribute('placeholder'))==='Необовʼязково' &&
   (await p.locator('#b-hrrest').getAttribute('placeholder'))==='Необовʼязково');
/* Placeholder зникає на фокусі (CSS робить його прозорим) */
await p.locator('#b-hrrest').focus();
ok('1. placeholder прозорий на фокусі',
   await p.evaluate(()=>getComputedStyle(document.getElementById('b-hrrest'),'::placeholder').color.includes('0, 0, 0, 0')));
await tap(p.locator('.seg__item:has(input[value="male"]) span'));
await p.locator('#b-weight').fill('82.4');
await p.locator('#b-height').fill('180');
await p.locator('#b-activity').selectOption('1.55');
await p.waitForTimeout(300);
/* Стаж обовʼязковий: без нього далі не пускає */
ok('1. без стажу кнопка вимкнена', await p.locator('#body-go').isDisabled());
await p.locator('#b-trainage').selectOption('inter');
await p.waitForTimeout(300);
ok('1. з заповненими полями можна далі (обидва пульси порожні — легально)', !(await p.locator('#body-go').isDisabled()));
/* Вписаний пульс спокою зберігається, хоч він і опційний */
await p.locator('#b-hrrest').fill('58');
await p.waitForTimeout(300);
await tap(p.locator('#body-go')); await p.waitForTimeout(600);
/* BMI 82,4 кг / 180 см = 25,4 — «надлишкова вага», і крок чесно показує
   попередження один раз на категорію (js/bmi-core.js). Це не діалог
   браузера, тож обробник p.on('dialog') його не бачить: підтверджуємо
   кнопкою, як людина. Без цього proceedBody() чекав би вічно. */
const bmiOk = p.locator('#bmi-w-ok');
if (await bmiOk.count()) { await bmiOk.click(); await p.waitForTimeout(400); }
await p.waitForTimeout(1200);
ok('1. крок «тіло» веде до програм', here()==='programs.html', here());
const bodyProf=await p.evaluate(async()=>await window.Store.getProfile());
ok('1. тіло лягло в профіль', bodyProf.sex==='male'&&bodyProf.weight===82.4&&bodyProf.height===180&&bodyProf.activity===1.55,
   JSON.stringify({sex:bodyProf.sex,w:bodyProf.weight,h:bodyProf.height,a:bodyProf.activity}));
ok('1. стаж і пульс спокою збережені, макс пульс — null',
   bodyProf.trainingAge==='inter'&&bodyProf.hrRest===58&&bodyProf.hrMax===null,
   JSON.stringify({t:bodyProf.trainingAge,hr:bodyProf.hrRest,hm:bodyProf.hrMax}));

// 2. Програма
await p.waitForTimeout(500);
ok('2. банер пояснює крок 3 з 3', /Крок 3 з 3/.test(await p.locator('#onboard-banner').innerText().catch(()=>'')));
ok('2. меню згорнуте до знака: іти нікуди', await p.locator('.nav__links').count()===0);
await tap(p.locator('[data-pick]').first()); await p.waitForTimeout(700);
await tap(p.locator('#adopt-plan')); await p.waitForTimeout(1200);
ok('2. вибір програми веде в план', here()==='plan.html', here());
const after=await p.evaluate(async()=>await window.Store.getProfile());
ok('2. план обрано', !!(after.activePlan && after.activePlan.programId), JSON.stringify(after.activePlan));

// 3. Робоча вага — останній крок
await p.waitForTimeout(500);
ok('3. банер просить робочу вагу', /робочу вагу/.test(await p.locator('#onboard-banner').innerText().catch(()=>'')));
/* Головна ще зачинена */
await p.goto(U('index.html')); await p.waitForTimeout(700);
ok('3. без ваги головна ще зачинена', here()==='programs.html'||here()==='plan.html', here());
await p.goto(U('plan.html')); await p.waitForTimeout(900);
const accs=p.locator('#plan .acc');
let dayIdx=0;
for (let i=0;i<await accs.count();i++){
  if (await accs.nth(i).locator('input[data-act=weight]').count()>0){dayIdx=i;break;}
}
await tap(accs.nth(dayIdx).locator('.acc__head')); await p.waitForTimeout(500);
const wt=p.locator('#plan .acc.is-open input[data-act=weight]').first();
await wt.fill('60'); await wt.blur(); await p.waitForTimeout(1000);
const weights=await p.evaluate(async()=>(await window.Store.getProfile()).weights);
ok('3. вага збереглась', Object.values(weights||{}).some(v=>Number(v)===60), JSON.stringify(weights));
ok('3. банер каже «готово»', /Готово/.test(await p.locator('#onboard-banner').innerText().catch(()=>'')), 'банер');

// 4. Forge відкрився
await p.goto(U('index.html')); await p.waitForTimeout(1000);
ok('4. головна відкрилась', here()==='index.html', here());
ok('4. повне меню повернулось', await p.locator('.nav__links').count()===1);
ok('4. мобільна панель розділів на місці', await p.locator('#tabbar .tabbar__item').count()===4);
/* Локальний режим (без ключів Supabase): сезонний ELO живе лише на
   сервері, тож бейджа немає, а картка сезону чесно це пояснює. */
ok('4. бейдж сезону прихований у локальному режимі', await p.locator('.nav__rating').isHidden());
ok('4. картка сезону пояснює локальний режим',
   /локальному режимі/.test(await p.locator('#today .card--rating').innerText()));
ok('4. «Сьогодні» показує картку-вхід у тренування',
   (await p.locator('#tdy-training').getAttribute('href'))==='workout.html');
/* welcome.html пройденому більше не показується */
await p.goto(U('welcome.html')); await p.waitForTimeout(800);
ok('4. на гейт більше не потрапити', here()==='index.html', here());

// 5. Ціль калорій (вага з КОМОЮ, як на iOS)
await p.goto(U('nutrition.html')); await p.waitForTimeout(800);
await p.locator('#n-weight').fill('82,4');
await tap(p.locator('input[name="goal"][value="cut"]').first()).catch(()=>{});
await tap(p.locator('#n-save')); await p.waitForTimeout(800);
const prof=await p.evaluate(async()=>await window.Store.getProfile());
ok('5. вага з комою прийнялась', prof.weight===82.4, 'weight='+prof.weight);
ok('5. ціль калорій рахується', !!(await p.evaluate(async()=>!!window.NutritionCalc.targetFor(await window.Store.getProfile()))));

// 6. Тренування
await p.goto(U('workout.html')); await p.waitForTimeout(1100);
ok('6. сторінка тренування показує список вправ', await p.locator('.tdy-ex').count()>0);
await tap(p.locator('.tdy-ex [data-set-n="1"]').first()); await p.waitForTimeout(2200);
const sess=await p.evaluate(async()=>(await window.Store.getProfile()).sessionLog);
ok('6. галочка потрапила в історію', Object.keys(sess||{}).length>0);
const wt2=p.locator('[data-wt]').first();
await wt2.fill('62,5'); await wt2.blur(); await p.waitForTimeout(800);
const nm=await wt2.getAttribute('data-wt');
const w=await p.evaluate(async n=>(await window.Store.getProfile()).weights[n],nm);
ok('6. робоча вага з комою зберіглась', w===62.5, 'w='+w);

// 7. Харчування
await p.goto(U('meals.html')); await p.waitForTimeout(900);
await tap(p.locator('[data-add-to="0"]').first());
await p.locator('#d-quick').fill('рис'); await p.waitForTimeout(500);
await tap(p.locator('.quick-list__item').first()); await p.waitForTimeout(400);
await tap(p.locator('#m-add')); await p.waitForTimeout(800);
const day=await p.evaluate(async()=>(await window.Store.getProfile()).day);
ok('7. продукт додано в день', day.meals.reduce((s,m)=>s+m.items.length,0)===1);

// 8. Прогрес
await p.goto(U('journal.html')); await p.waitForTimeout(900);
await p.locator('#w-kg').fill('82,4'); await tap(p.locator('#w-add')); await p.waitForTimeout(800);
const bl=await p.evaluate(async()=>(await window.Store.getProfile()).bodyLog);
ok('8. вага тіла з комою записалась', Object.values(bl||{}).includes(82.4), JSON.stringify(bl));

// 9. Повернення наступного дня
await p.goto(U('index.html')); await p.waitForTimeout(1200);
const tiles=await p.locator('#today .tiles').innerText();
ok('9. панель показує живі числа, а не прочерки', !/^—$/m.test(tiles) && /\d/.test(tiles), tiles.replace(/\n/g,' | ').slice(0,120));
ok('9. бейдж сезону так і прихований (локальний режим)', await p.locator('.nav__rating').isHidden());
ok('весь шлях без JS-помилок', errs.length===0, errs.join(' | '));

await b.close();
const bad=R.filter(r=>!r[1]);
console.log('\n'+(R.length-bad.length)+'/'+R.length+' кроків шляху новачка пройшло.');
process.exit(bad.length?1:0);
