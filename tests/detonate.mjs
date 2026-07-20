// 右鍵=攻擊、E=互動 + 道具引爆桶/瓶(玩家反饋:拿火帽/水錘想引爆瓶,右鍵卻變舉瓶)驗收:
// ①持火帽近瓶按右鍵=開火不撿瓶(排程施放、瓶沒被舉) ②同況按 E=撿瓶(互動優先分工)
// ③空手右鍵近瓶=照舊撿瓶 ④持傳送(mobility)右鍵近桶=照舊撿桶(逃脫類不佔右鍵優先)
// ⑤火帽引爆油瓶=瓶碎+油膜同一發點燃(火海) ⑥火帽扇內桶=升壓 ⑦水錘 AoE=瓶碎+桶升壓(水蓋掉潑出的油)
// ⑧電鞭線上=瓶碎+桶升壓
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
const resetAll = () => page.evaluate(async () => {
  const M = await import('./js/v2-floor.js'); M.resetFloor();
  const v = __v2;
  for (const t of v.bottles) { t.alive = true; t.respawn = 0; t.held = false; t.x = t.x0; t.y = t.y0; t.vx = t.vy = 0; t.flyT0 = -9; t.landed = true; t.z = 0; t._smash = false; }
  for (const b of v.barrels) { b.alive = true; b.state = 'idle'; b.fuse = 0; b.held = false; b.vx = b.vy = 0; b.x = b.pid === undefined ? b.x : b.x; }
  v.barrels[0].x = 200; v.barrels[0].y = 320; v.barrels[1].x = 760; v.barrels[1].y = 320;
  for (const f of v.fighters) { f.stunned = false; f.carryObj = null; f.carrying = null; f.item = null; f.itemUses = 0; f._itemCastAt = 0; f._itemCastType = null; f.itemCastCd = 0; f.regrabCd = 0; f.fumbleT = 0; }
  v.fighters[0].x = 60; v.fighters[0].y = 60; v.fighters[1].x = 60; v.fighters[1].y = 600;
});
await page.evaluate(() => { __v2.fighters[1].ai = false; });

// ---------- ① 持火帽近瓶按右鍵 = 開火不撿瓶 ----------
await resetAll();
let s1; // 重試×3(陷阱 #11)+ 補 cd/castAt 重置(原缺=前案殘留 cd 會讓 useItem 空轉)
for (let i = 0; i < 3 && !(s1 && s1.casting); i++) s1 = await page.evaluate(() => {
  const v = __v2, f = v.fighters[1], t = v.bottles[0];
  t.x = 340; t.y = 540; f.x = 300; f.y = 540; f.facing = 0; f.item = 'fire'; f.itemUses = 2;
  f.itemCastCd = 0; f._itemCastAt = 0; f.stunned = false; f.fumbleT = 0; f.carrying = null; f.carryObj = null;
  v.mouseRight(f);
  return { casting: f._itemCastAt > 0, type: f._itemCastType, uses: f.itemUses, pickedUp: !!f.carryObj, bottleHeld: t.held };
});
R(`持火帽近瓶右鍵=開火(排程 ${s1.type}、uses 2→${s1.uses})不撿瓶`, s1.casting && s1.type === 'fire' && s1.uses === 1 && !s1.pickedUp && !s1.bottleHeld);

// ---------- ② 同況按 E = 撿瓶(互動優先) ----------
await resetAll();
const s2 = await page.evaluate(() => {
  const v = __v2, f = v.fighters[1], t = v.bottles[0];
  t.x = 340; t.y = 540; f.x = 300; f.y = 540; f.facing = 0; f.item = 'fire'; f.itemUses = 2;
  v.contextAction(f);
  return { pickedUp: f.carryObj === t, held: t.held, casting: f._itemCastAt > 0, item: f.item };
});
R('同況按 E=撿瓶(裝備仍在手、沒開火)', s2.pickedUp && s2.held && !s2.casting && s2.item === 'fire');

// ---------- ③ 空手右鍵近瓶 = 照舊撿瓶 ----------
await resetAll();
const s3 = await page.evaluate(() => {
  const v = __v2, f = v.fighters[1], t = v.bottles[0];
  t.x = 340; t.y = 540; f.x = 300; f.y = 540; f.facing = 0; f.item = null;
  v.mouseRight(f);
  return { pickedUp: f.carryObj === t };
});
R('空手右鍵近瓶=照舊撿瓶', s3.pickedUp);

// ---------- ④ 持傳送(mobility)右鍵近桶 = 照舊撿桶 ----------
await resetAll();
const s4 = await page.evaluate(() => {
  const v = __v2, f = v.fighters[1], b = v.barrels[0];
  b.x = 340; b.y = 540; f.x = 300; f.y = 540; f.facing = 0; f.item = 'teleport'; f.itemUses = 1;
  v.mouseRight(f);
  return { pickedUp: f.carryObj === b, item: f.item };
});
R('持傳送(逃脫類)右鍵近桶=照舊撿桶(傳送不被誤放)', s4.pickedUp && s4.item === 'teleport');

// ---------- ⑤ 火帽引爆油瓶 = 瓶碎 + 油膜同一發點燃(火海) ----------
await resetAll();
const s5 = await page.evaluate(() => {
  const v = __v2, f = v.fighters[1];
  const t = v.bottles.find(b => b.alive) || v.bottles[0]; t.elem = 'oil';
  t.x = 360; t.y = 540; f.x = 300; f.y = 540; f.facing = 0;
  v.castFire(f);
  return { shattered: !t.alive, tx: Math.round(t.x) };
});
const s5floor = await floorAt(360, 540);
R(`火帽引爆油瓶=瓶碎+油膜同發點燃(floor=${s5floor})`, s5.shattered && s5floor === 'fire');

// ---------- ⑥ 火帽扇內桶 = 升壓 ----------
await resetAll();
const s6 = await page.evaluate(() => {
  const v = __v2, f = v.fighters[1], b = v.barrels[0];
  b.x = 360; b.y = 540; f.x = 300; f.y = 540; f.facing = 0;
  v.castFire(f);
  return { state: b.state };
});
R(`火帽扇內桶=升壓(${s6.state})`, s6.state === 'fuse');

// ---------- ⑦ 水錘 AoE = 瓶碎(潑油被水蓋掉)+ 桶升壓 ----------
await resetAll();
const s7 = await page.evaluate(() => {
  const v = __v2, f = v.fighters[1], b = v.barrels[0];
  const t = v.bottles.find(x => x.alive) || v.bottles[0]; t.elem = 'oil';
  t.x = 360; t.y = 540; b.x = 340; b.y = 560;
  f.x = 300; f.y = 540; f.facing = 0;                       // 落點 (348,540),WATER_R 70 蓋到兩者
  v.castWater(f);
  return { shattered: !t.alive, barrel: b.state };
});
const s7floor = await floorAt(360, 540);
R(`水錘 AoE=瓶碎+潑油被水蓋掉(floor=${s7floor})+桶升壓(${s7.barrel})`, s7.shattered && s7floor === 'water' && s7.barrel === 'fuse');

// ---------- ⑧ 電鞭線上 = 瓶碎 + 桶升壓 ----------
await resetAll();
const s8 = await page.evaluate(() => {
  const v = __v2, f = v.fighters[1], b = v.barrels[0];
  const t = v.bottles.find(x => x.alive) || v.bottles[0]; t.elem = 'ice';
  t.x = 350; t.y = 545; b.x = 450; b.y = 535;               // 都貼在線(y=540 ±半寬 20+r)上
  f.x = 200; f.y = 540; f.facing = 0;
  v.castLightning(f);
  return { shattered: !t.alive, barrel: b.state };
});
R(`電鞭線上=瓶碎+桶升壓(${s8.barrel})`, s8.shattered && s8.barrel === 'fuse');

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
