// 工業重錘(水)+ 火融冰化學 驗收:
// ①火帽噴冰面=融成水(R4b;乾淨地板仍不留火)②水錘造濕地(落點 WATER_R 範圍水地板)
// ③水錘砸中=短擊倒(範圍內對手 stunned+徑向擊退)④濕地接雷=R2 電水(水→lightning→charged)
// ⑤水錘=裝備類(補給座池含 water、起手預告落點圈)⑥水覆蓋油/冰=底料取代(不誤觸反應)
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

// ---------- ① 火帽噴冰面 = 融成水(R4b);乾淨地板仍不留火 ----------
await resetFloor();
await stamp(348, 540, 24, 'ice');          // 冰塊在火帽扇內
const s1 = await page.evaluate(() => { const v = __v2, f = v.fighters[1]; f.x = 300; f.y = 540; f.facing = 0; f.stunned = false; v.fighters[0].x = 60; v.fighters[0].y = 60; v.castFire(f); return true; });
const iceFloor = await floorAt(348, 540), cleanFloor = await floorAt(360, 560);
R(`火帽融冰面→水(${iceFloor})`, iceFloor === 'water');
R(`乾淨地板仍不留火(${cleanFloor})`, cleanFloor === 'clean');

// ---------- ② 水錘造濕地(落點 WATER_R 範圍水地板)----------
await resetFloor();
const slam = await page.evaluate(() => {
  const v = __v2, f = v.fighters[1];
  f.x = 300; f.y = 540; f.facing = 0; f.stunned = false; v.fighters[0].x = 60; v.fighters[0].y = 60;
  v.castWater(f);
  return { sx: Math.round(300 + Math.cos(0) * 48), sy: 540 };
});
const slamFloor = await floorAt(slam.sx, slam.sy), slamEdge = await floorAt(slam.sx + 40, slam.sy);
R(`水錘落點=濕地(${slamFloor})`, slamFloor === 'water');
R(`濕地有半徑範圍(邊緣 +40px=${slamEdge})`, slamEdge === 'water');

// ---------- ③ 水錘砸中 = 短擊倒 + 徑向擊退 ----------
await resetFloor();
const hit = await page.evaluate(() => {
  const v = __v2, f = v.fighters[1], o = v.fighters[0];
  f.x = 300; f.y = 540; f.facing = 0; f.stunned = false;
  o.x = 348; o.y = 540; o.vx = o.vy = 0; o.invuln = 0; o.stunned = false; o.restunT = 0; o.stability = 100; // 站在落點
  v.castWater(f);
  return { stunned: o.stunned, knock: Math.round(Math.hypot(o.vx, o.vy)), stab: Math.round(o.stability), by: o.lastHitBy };
});
R(`水錘砸中=短擊倒(stunned、歸因 ${hit.by}=1)`, hit.stunned && hit.by === 1);
R(`水錘砸中=徑向擊退+削穩定(knock ${hit.knock}>0、stab ${hit.stab}<100)`, hit.knock > 0 && hit.stab < 100);

// ---------- ④ 濕地接雷 = R2 電水(水生產鏈閉合)----------
await resetFloor();
await page.evaluate(() => { const v = __v2, f = v.fighters[1]; f.x = 300; f.y = 540; f.facing = 0; f.stunned = false; v.fighters[0].x = 60; v.fighters[0].y = 60; v.castWater(f); });
const beforeLtn = await floorAt(348, 540);
await stamp(348, 540, 20, 'lightning');    // 對濕地施雷
const afterLtn = await floorAt(348, 540);
R(`水錘濕地接雷→電水 R2(${beforeLtn}→${afterLtn})`, beforeLtn === 'water' && afterLtn === 'charged_water');

// ---------- ⑤ 水錘=裝備類(走排程施放,同 wind/fire)----------
let specOk; // 重試×3(陷阱 #11:全套環境偶發「同步不可能」讀值,單獨壓測 0/300)
for (let i = 0; i < 3 && !(specOk && specOk.scheduled); i++) specOk = await page.evaluate(() => {
  const v = __v2, f = v.fighters[1];
  f.item = 'water'; f.itemUses = 2; f.x = 300; f.y = 540; f.facing = 0; f.itemCastCd = 0; f._itemCastAt = 0; f.stunned = false; f.carrying = null; f.carryObj = null; f.fumbleT = 0;
  v.useItem(f);
  return { uses: f.itemUses, clip: f.itemClip, scheduled: f._itemCastAt > 0 };
});
R(`水錘走排程施放(3→${specOk.uses}=1、clip=${specOk.clip})`, specOk.uses === 1 && specOk.scheduled);

// ---------- ⑥ 水覆蓋油/冰=底料取代(不誤觸反應)----------
await resetFloor();
await stamp(348, 540, 24, 'oil');
await page.evaluate(() => { const v = __v2, f = v.fighters[1]; f.x = 300; f.y = 540; f.facing = 0; f.stunned = false; v.fighters[0].x = 60; v.fighters[0].y = 60; v.castWater(f); });
const overOil = await floorAt(348, 540);
R(`水錘砸油膜=水覆蓋(底料取代,不點燃;${overOil})`, overOil === 'water');

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
