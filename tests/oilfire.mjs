// 油+火驗收(瓶=場上物件、火帽=短扇形不留地形火):①②丟油瓶 prop=油膜(FL.OIL)不凍人
// ③噴火帽=乾淨地板不留火(只點油)+直擊目標著火 DoT ④核心連段:油膜上噴火→只點扇內油→R1 火海沿油擴散
// 陷阱:LOCAL facing 吃滑鼠 → 用 fighters[1] 當施法者;rAF 節流 → game.time 輪詢
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage(); const errs = [];
page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.goto('http://localhost:8099/v2.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };
const advance = sec => page.evaluate(s => new Promise(res => { const t0 = __v2.game.time; const iv = setInterval(() => { if (__v2.game.time - t0 >= s) { clearInterval(iv); res(); } }, 20); }), sec);
await page.evaluate(() => { __v2.fighters[1].ai = false; });
const floorAt = (x, y) => page.evaluate(([x, y]) => import('./js/v2-floor.js').then(M => M.stateAtPixel(x, y)), [x, y]);

// ---------- ①② 丟油瓶(場上物件版)=油膜、不凍人 ----------
const s1 = await page.evaluate(() => {
  const v = __v2, f = v.fighters[1], o = v.fighters[0];
  o.x = 60; o.y = 60; o.frozen = false;
  const t = v.bottles.find(b => b.alive) || v.bottles[0]; t.elem = 'oil'; // oil 退垃圾型 → 強制設測油膜
  f.x = 200; f.y = 520; f.facing = 0; f.stunned = false; f.carryObj = null; f.carrying = null;
  t.x = f.x; t.y = f.y; t.held = true; f.carryObj = t;
  v.launchBarrel(f);
  return { flying: !t.landed };
});
R('丟油瓶出手(prop 彈道)', s1.flying);
await advance(0.7);
const land = await page.evaluate(async () => { const M = await import('./js/v2-floor.js'); return { st: M.stateAtPixel(228 + 180, 520), frozen: __v2.fighters[0].frozen }; });
R(`油瓶落地=油膜(${land.st})`, land.st === 'oil');
R('油瓶不凍人(對手未 frozen)', !land.frozen);

// ---------- ③ 噴火帽=短扇形:乾淨地板不留火(只點油)+ 直擊目標著火 DoT ----------
const fire = await page.evaluate(async () => {
  const v = __v2, f = v.fighters[1], o = v.fighters[0];
  const M = await import('./js/v2-floor.js');
  M.resetFloor();                                          // 清地板 → 保證落點乾淨(排除 ② 的油)
  f.x = 300; f.y = 540; f.facing = 0; f.stunned = false;   // 南邊空地
  o.x = 360; o.y = 540; o.vx = o.vy = 0; o.invuln = 0; o.stunned = false; o.stability = 100; o.frozen = false; o.burnT = 0; // d=60 < RANGE 88
  v.castFire(f);
  return { stab: Math.round(o.stability), burning: o.burnT > 0, cleanFloor: M.stateAtPixel(300 + 60, 540) };
});
R(`噴火帽:乾淨地板不留火(落點=${fire.cleanFloor})`, fire.cleanFloor === 'clean');
R(`噴火帽:直擊即扣穩定值(${fire.stab}<100)`, fire.stab < 100);
R('噴火帽:目標著火(burnT>0)', fire.burning);
await advance(0.6);   // floorHazards 續燒
const burn2 = await page.evaluate(() => ({ stab: Math.round(__v2.fighters[0].stability), by: __v2.fighters[0].lastHitBy }));
R(`著火續燒:穩定值再降(${fire.stab}→${burn2.stab})`, burn2.stab < fire.stab);

// ---------- ④ 核心連段:油膜上噴火 → 只點扇內油 → R1 火海沿油擴散 ----------
const combo = await page.evaluate(async () => {
  const v = __v2, f = v.fighters[1], o = v.fighters[0];
  o.x = 60; o.y = 60; o.invuln = 5; o.burnT = 0;          // 對手挪遠免干擾
  const M = await import('./js/v2-floor.js');
  M.resetFloor();
  M.stampElement(490, 300, 100, 'oil');                   // 油膜(近端搆得到、遠端 540 在扇外)
  f.x = 400; f.y = 300; f.facing = 0; f.stunned = false;  // 東噴,扇達 500
  const oilBefore = M.stateAtPixel(540, 300);
  v.castFire(f);                                          // 只點扇內油格(~440)
  const igniteNear = M.stateAtPixel(440, 300), farBefore = M.stateAtPixel(540, 300);
  return { oilBefore, igniteNear, farBefore };
});
R(`連段前置:油膜鋪好(${combo.oilBefore})`, combo.oilBefore === 'oil');
R(`只點扇內油格立即燃(近${combo.igniteNear}、扇外遠端油仍未燒=${combo.farBefore})`, combo.igniteNear === 'fire' && combo.farBefore === 'oil');
await advance(0.6);   // stepFloor R1 沿油擴散到扇外遠端
const spread = await floorAt(540, 300);
R(`火沿油擴散→火海 R1(遠端 ${spread})`, spread === 'fire');

// ---------- ⑤ 起手預告扇形:施法窗中 game.fireAims 有一筆、帶正確射程/面向;impact 後清空 ----------
await page.evaluate(() => { const v = __v2, f = v.fighters[1]; f.x = 300; f.y = 540; f.facing = 0; f.item = 'fire'; f.itemUses = 2; f.itemCastCd = 0; f._itemCastAt = 0; f.stunned = false; f.carryObj = null; f.carrying = null; v.fighters[0].x = 60; v.fighters[0].y = 60; v.useItem(f); });
await advance(0.05); // 讓 step 幀尾重建 fireAims(施法窗內)
const aim = await page.evaluate(() => { const a = __v2.game.fireAims; return { n: a.length, range: a[0] ? Math.round(a[0].range) : -1, angle: a[0] ? +a[0].angle.toFixed(2) : -9, casting: __v2.fighters[1]._itemCastAt > __v2.game.time }; });
R(`起手預告:施法窗中 fireAims 有一筆(range=${aim.range}=100、面向${aim.angle})`, aim.n === 1 && aim.range === 100 && aim.angle === 0 && aim.casting);
await advance(0.5); // 過 impact
const aim2 = await page.evaluate(() => ({ n: __v2.game.fireAims.length, casting: __v2.fighters[1]._itemCastAt > __v2.game.time }));
R('impact 後 fireAims 清空(預告只在起手窗)', aim2.n === 0 && !aim2.casting);

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close(); process.exit(fail ? 1 : 0);
