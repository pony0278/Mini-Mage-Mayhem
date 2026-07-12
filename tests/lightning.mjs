// 魔導電鞭(雷)= 直線電擊 驗收:
// ①直線命中線內對手=電擊擊暈+沿線小擊退 ②線外(垂直距離>半寬)不中 ③沿線給水充電=R2 電水
// ④乾淨地板 no-op(不亂改) ⑤排程施放(uses2→1、rhook、scheduled) ⑥起手預告直線(boltAims)+發射亮束(bolts)
// 陷阱:LOCAL(fighters[0]) facing 吃滑鼠 → 施放者一律 fighters[1];POD(480,320,r46) 污染 → 擺南邊;rAF 節流 → game.time 輪詢
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.goto('http://localhost:8099/v2.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };
const advance = sec => page.evaluate(s => new Promise(res => { const t0 = __v2.game.time; const iv = setInterval(() => { if (__v2.game.time - t0 >= s) { clearInterval(iv); res(); } }, 20); }), sec);
const floorAt = (x, y) => page.evaluate(([x, y]) => import('./js/v2-floor.js').then(M => M.stateAtPixel(x, y)), [x, y]);
const resetFloor = () => page.evaluate(() => import('./js/v2-floor.js').then(M => M.resetFloor()));
const stamp = (x, y, r, el) => page.evaluate(([x, y, r, el]) => import('./js/v2-floor.js').then(M => M.stampElement(x, y, r, el)), [x, y, r, el]);
await page.evaluate(() => { __v2.fighters[1].ai = false; });

// ---------- ① 直線命中線內對手 = 電擊擊暈 + 沿線小擊退 ----------
await resetFloor();
const hit = await page.evaluate(() => {
  const v = __v2, f = v.fighters[1], o = v.fighters[0];
  f.x = 200; f.y = 540; f.facing = 0; f.stunned = false;                     // 東向直線
  o.x = 350; o.y = 540; o.vx = o.vy = 0; o.invuln = 0; o.stunned = false; o.restunT = 0; o.stability = 100; // 線上(along=150、perp=0)
  v.castLightning(f);
  return { stunned: o.stunned, knock: Math.round(Math.hypot(o.vx, o.vy)), kx: Math.round(o.vx), by: o.lastHitBy };
});
R(`直線命中=電擊擊暈(stunned、歸因 ${hit.by}=1)`, hit.stunned && hit.by === 1);
R(`沿線小擊退(往前 vx ${hit.kx}>0)`, hit.kx > 0);

// ---------- ② 線外(垂直距離 > 半寬+r)不中 ----------
await resetFloor();
const miss = await page.evaluate(() => {
  const v = __v2, f = v.fighters[1], o = v.fighters[0];
  f.x = 200; f.y = 540; f.facing = 0; f.stunned = false;
  o.x = 350; o.y = 600; o.vx = o.vy = 0; o.invuln = 0; o.stunned = false; o.restunT = 0; // perp=60 > WIDTH 20 + r 19
  v.castLightning(f);
  return { stunned: o.stunned };
});
R('線外不中(perp>半寬+r=不 stunned)', !miss.stunned);

// ---------- ③ 沿線給水充電 = R2 電水 ----------
await resetFloor();
await stamp(350, 540, 20, 'water');                                          // 線上鋪一片水
const before3 = await floorAt(350, 540);
await page.evaluate(() => { const v = __v2, f = v.fighters[1]; f.x = 200; f.y = 540; f.facing = 0; f.stunned = false; v.fighters[0].x = 60; v.fighters[0].y = 60; v.castLightning(f); });
const after3 = await floorAt(350, 540);
R(`沿線給水充電→電水 R2(${before3}→${after3})`, before3 === 'water' && after3 === 'charged_water');

// ---------- ④ 乾淨地板 no-op(直線經過乾淨地板不亂改)----------
await resetFloor();
await page.evaluate(() => { const v = __v2, f = v.fighters[1]; f.x = 200; f.y = 540; f.facing = 0; f.stunned = false; v.fighters[0].x = 60; v.fighters[0].y = 60; v.castLightning(f); });
const clean4 = await floorAt(350, 540);
R(`乾淨地板 no-op(線上仍 clean=${clean4})`, clean4 === 'clean');

// ---------- ⑤ 排程施放 ----------
const sched = await page.evaluate(() => {
  const v = __v2, f = v.fighters[1];
  f.item = 'lightning'; f.itemUses = 2; f.x = 200; f.y = 540; f.facing = 0; f.itemCastCd = 0; f._itemCastAt = 0; f.stunned = false; f.carrying = null; f.carryObj = null;
  v.useItem(f);
  return { uses: f.itemUses, clip: f.itemClip, scheduled: f._itemCastAt > 0, type: f._itemCastType };
});
R(`雷走排程施放(2→${sched.uses}=1、clip=${sched.clip}、type=${sched.type})`, sched.uses === 1 && sched.scheduled && sched.type === 'lightning');

// ---------- ⑥ 起手預告直線(boltAims)+ 發射亮束(bolts)----------
await advance(0.05); // step 幀尾重建 boltAims(施法窗內)
const aim = await page.evaluate(() => { const a = __v2.game.boltAims; return { n: a.length, range: a[0] ? Math.round(a[0].range) : -1, angle: a[0] ? +a[0].angle.toFixed(2) : -9 }; });
R(`起手預告:施法窗中 boltAims 有一筆(range=${aim.range}=260、面向${aim.angle})`, aim.n === 1 && aim.range === 260 && aim.angle === 0);
// 清舊束(①-④ 直接 cast 留的,rAF 節流下 game.time 走慢還沒淡出),再輪詢排程 cast 實際 resolve(_itemCastType 歸 null)
await page.evaluate(() => { __v2.game.bolts.length = 0; });
await page.evaluate(() => new Promise(res => { const v = __v2, f = v.fighters[1], t0 = v.game.time; const iv = setInterval(() => { if (!f._itemCastType || v.game.time - t0 > 1.5) { clearInterval(iv); res(); } }, 15); }));
const flash = await page.evaluate(() => ({ aims: __v2.game.boltAims.length, bolts: __v2.game.bolts.length }));
R(`impact 後發射亮束 bolts 生成 + boltAims 清空(bolts=${flash.bolts}、aims=${flash.aims})`, flash.bolts >= 1 && flash.aims === 0);

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
