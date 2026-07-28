// SMOKE ROOM 道具測試間(smoke-1;使用者「建立一個 smokeroom 我自由測試道具」)驗收:
// ①頁面載入+面板出現(#smokeroom)且開房即測(introT=0/tutorial 關/假人 AI 關)
// ②給道具(按鈕入口 giveItem)=item+滿次數 ③彈藥無限=用掉後自動補滿 ④假人無敵=invuln 撐住
// ⑤解除狀態=暈眩/燃燒鏈一鍵清 ⑥地板鋪設=假人腳下油格 ⑦清地板 ⑧快捷鍵 1=風壓 ⑨無 console 錯誤。
// 陷阱:面板 module 在 v2.js 之後依文件順序執行——等 window.__smokeroom(不是只等 __v2)。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.goto('http://localhost:8099/smokeroom.html?turbo=8', { waitUntil: 'networkidle0' });
await page.bringToFront();
await page.waitForFunction('window.__v2 && window.__smokeroom', { timeout: 20000 });
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

// ---------- ① 開房即測 ----------
const boot = await page.evaluate(() => ({ panel: !!document.getElementById('smokeroom'), introT: __v2.v2s.introT, tut: __v2.v2s.tutorial, ai: __v2.fighters[1].ai }));
R('面板出現+開房即測(introT=0/教學關/AI 關)', boot.panel && boot.introT <= 0 && !boot.tut && !boot.ai, JSON.stringify(boot));

// ---------- ② 給道具 ----------
const give = await page.evaluate(async () => {
  const m = await import('./js/v2-state.js');
  __smokeroom.giveItem('lightning');
  const f = __v2.fighters[0];
  return { item: f.item, uses: f.itemUses, want: m.ITEM_SPEC.lightning.uses };
});
R('給道具=item+滿次數(電鞭)', give.item === 'lightning' && give.uses === give.want, JSON.stringify(give));

// ---------- ③ 彈藥無限 ----------
await page.evaluate(() => {
  document.querySelectorAll('#smokeroom input[type=checkbox]')[0].click();   // 第一個 checkbox=彈藥無限
  __smokeroom.giveItem('fire');
  const f = __v2.fighters[0]; f.itemUses = 1;                                // 模擬用到剩 1
});
const inf = await page.waitForFunction('__v2.fighters[0].itemUses >= 2', { timeout: 5000 }).then(() => true).catch(() => false);
R('彈藥無限=自動補滿(1→2)', inf);

// ---------- ④ 假人無敵 ----------
await page.evaluate(() => { document.querySelectorAll('#smokeroom input[type=checkbox]')[2].click(); }); // AI開/無敵/…順序:0=無限 1=AI 2=無敵
const inv = await page.waitForFunction('__v2.fighters[1].invuln > 50', { timeout: 5000 }).then(() => true).catch(() => false);
R('假人無敵=invuln 撐住', inv);
await page.evaluate(() => { document.querySelectorAll('#smokeroom input[type=checkbox]')[2].click(); }); // 關回

// ---------- ⑤ 解除狀態 ----------
const cure = await page.evaluate(() => {
  const o = __v2.fighters[1];
  o.stunned = true; o.stunT = 9; o._burnCh = { t0: 0 }; o.burnT = 3; o.frozen = true; o.stability = 5; o.z = 40;
  __smokeroom.cureDummy();
  return { stun: o.stunned, ch: !!o._burnCh, frozen: o.frozen, stab: o.stability, z: o.z };
});
R('解除狀態=一鍵清(暈/鏈/凍/穩定/騰空)', !cure.stun && !cure.ch && !cure.frozen && cure.stab === 100 && cure.z === 0, JSON.stringify(cure));

// ---------- ⑥⑦ 地板鋪設/清除 ----------
const floor = await page.evaluate(() => {
  __smokeroom.stamp('oil');
  const o = __v2.fighters[1];
  const st = __smokeroom.stateAtPixel(o.x, o.y);
  const before = st;
  return { before };
});
R('鋪油=假人腳下油格', floor.before === 'oil', JSON.stringify(floor));
const cleared = await page.evaluate(async () => {
  const fl = await import('./js/v2-floor.js');
  fl.resetFloor();
  const o = __v2.fighters[1];
  return __smokeroom.stateAtPixel(o.x, o.y);
});
R('清地板=回乾淨', cleared === 'clean', cleared);

// ---------- ⑧ 快捷鍵 ----------
await page.evaluate(() => { const f = __v2.fighters[0]; f.item = null; });
await page.keyboard.press('1');
const hot = await page.waitForFunction('__v2.fighters[0].item === "wind"', { timeout: 5000 }).then(() => true).catch(() => false);
R('快捷鍵 1=風壓手套', hot);

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
