// 鎖滑驗收:①走著踩進冰=鎖直線滑(操控無效)②滑出冰面=動量交還+減速 ③冰上被擊退=鎖滑
// ④撞牆(含場邊)=停+暈 ⑤靜止站上冰=小心走(ICE_WALK,不鎖)⑥滑進艙=收容 cause 'ice'
// 陷阱:走路輸入吃 CAM.azimuth 旋轉 → 測試先歸零;headless rAF 節流 → 全部以 game.time 輪詢
import puppeteer from 'puppeteer';

const B = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = [];
page.on('pageerror', e => errs.push('PAGE ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.goto('http://localhost:8099/v2.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();

let pass = 0, fail = 0;
const R = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? '  [' + extra + ']' : '')); ok ? pass++ : fail++; };
const advance = sec => page.evaluate(s => new Promise(res => {
  const t0 = window.__v2.game.time;
  const iv = setInterval(() => { if (window.__v2.game.time - t0 >= s) { clearInterval(iv); res(); } }, 25);
}), sec);
// 等條件成立(game-time 逾時)
const waitFor = (fnStr, tmax = 4) => page.evaluate((src, tm) => new Promise(res => {
  const f = new Function('v', 'return (' + src + ')'); const v = window.__v2, t0 = v.game.time;
  const iv = setInterval(() => { const ok = f(v); if (ok || v.game.time - t0 > tm) { clearInterval(iv); res(!!ok); } }, 25);
}), fnStr, tmax);

await page.evaluate(async () => {
  const v = __v2; v.CAM.azimuth = 0;               // 走路輸入=純 +x(camRel 不旋轉)
  v.fighters[1].ai = false; v.fighters[1].x = 860; v.fighters[1].y = 140; // 假人先挪去角落
  const M = await import('./js/v2-floor.js');
  window.__stamp = (x, y, r) => M.stateAtPixel && (window.__ice = M.stampElement(x, y, r, 'ice'));
  window.__floorAt = (x, y) => M.stateAtPixel(x, y);
});

// ---------- ① 走著踩進冰 → 鎖滑 ----------
await page.evaluate(() => {
  const p = __v2.fighters[0];
  p.x = 220; p.y = 520; p.vx = p.vy = 0; p.invuln = 0; p._onIce = false; p._slideVx = 0; p._slideVy = 0;
  __stamp(400, 520, 90);                           // 冰帶 x≈310–490
});
await page.keyboard.down('d');
const locked = await waitFor('v.fighters[0]._slideVx !== 0 || v.fighters[0]._slideVy !== 0', 4);
const s1 = await page.evaluate(() => { const p = __v2.fighters[0]; return { vx: Math.round(p._slideVx), vy: Math.round(p._slideVy), x: Math.round(p.x) }; });
R(`走進冰=鎖滑(v=${s1.vx},${s1.vy} @x${s1.x})`, locked && s1.vx >= 215 && Math.abs(s1.vy) < 10);
// 操控無效:換按反向+側向,方向不變
await page.keyboard.up('d'); await page.keyboard.down('a'); await page.keyboard.down('s');
await advance(0.15);
const s2 = await page.evaluate(() => { const p = __v2.fighters[0]; return { vx: Math.round(p._slideVx), vy: Math.round(p._slideVy), sliding: !!(p._slideVx || p._slideVy), x: Math.round(p.x) }; });
await page.keyboard.up('a'); await page.keyboard.up('s');
R(`滑行中操控無效(方向不變 v=${s2.vx},${s2.vy})`, (!s2.sliding && s2.x > 460) || (s2.vx === s1.vx && s2.vy === s1.vy));

// ---------- ② 滑出冰面 → 解鎖+動量衰減 ----------
const exited = await waitFor('!v.fighters[0]._slideVx && !v.fighters[0]._slideVy && v.fighters[0].x > 480', 4);
const s3 = await page.evaluate(() => { const p = __v2.fighters[0]; return { x: Math.round(p.x), y: Math.round(p.y), vx: Math.round(p.vx) }; });
R(`滑出冰面=解鎖+保留動量(x${s3.x} vx=${s3.vx})`, exited && s3.vx > 0);
R(`全程直線(y=${s3.y}≈520)`, Math.abs(s3.y - 520) < 6);
const slowed = await waitFor('Math.hypot(v.fighters[0].vx, v.fighters[0].vy) < 60', 4);
R('出冰後草地自然減速', slowed);

// ---------- ③④ 冰上被擊退=鎖滑 → 撞場邊=停+暈 ----------
await page.evaluate(() => {
  const t = __v2.fighters[1];
  t.x = 830; t.y = 520; t.vx = 0; t.vy = 0; t.stunned = false; t.stunT = 0; t.restunT = 0; t.frozen = false; t.invuln = 0; t._onIce = false; t._slideVx = 0; t._slideVy = 0;
  __stamp(880, 520, 90);                           // 場邊冰帶(x 到底 960)
  t.vx = 160;                                      // 冰上挨打的擊退速度(> SLIDE_KNOCK_V 120)
});
const knockLock = await waitFor('v.fighters[1]._slideVx > 0', 2);
R('冰上擊退>門檻=鎖滑', knockLock);
const wallStun = await waitFor('v.fighters[1].stunned && !v.fighters[1]._slideVx', 4);
const s4 = await page.evaluate(() => { const t = __v2.fighters[1]; return { x: Math.round(t.x), vx: Math.round(t.vx) }; });
R(`滑到撞牆=停+暈(x${s4.x} vx=${s4.vx})`, wallStun && s4.vx === 0);

// ---------- ⑤ 靜止站上冰=小心走(不鎖) ----------
await page.evaluate(() => {
  const p = __v2.fighters[0];
  p.x = 400; p.y = 520; p.vx = p.vy = 0; p._onIce = false; p._slideVx = 0; p._slideVy = 0; p.stunned = false; p.running = false;
  __stamp(400, 520, 90);                           // 重鋪(壽命保險)
});
await advance(0.3);                                 // 靜止幾幀 → _onIce=true(要蓋過 ④ 撞牆暈的 hitstop 0.12,hitstop 中 moveFighter 不跑)
await page.keyboard.down('d');
const walk = await page.evaluate(() => new Promise(res => {
  const v = __v2, p = v.fighters[0], x0 = p.x, t0 = v.game.time;
  const iv = setInterval(() => { if (v.game.time - t0 >= 0.4) { clearInterval(iv); res({ speed: (p.x - x0) / (v.game.time - t0), sliding: !!(p._slideVx || p._slideVy) }); } }, 25);
}));
await page.keyboard.up('d');
R(`站上冰起步=小心走 ${Math.round(walk.speed)}px/s(≈SPEED×0.4,不鎖滑)`, !walk.sliding && walk.speed > 30 && walk.speed < 110);

// ---------- ⑥ 滑進艙=收容 cause 'ice' ----------
const c6 = await page.evaluate(() => new Promise(res => {
  const v = __v2, t = v.fighters[1];
  t.x = 680; t.y = 320; t.vx = 0; t.vy = 0; t.stunned = false; t.stunT = 0; t.restunT = 0; t.frozen = false; t.fumbleT = 0; t.invuln = 0; t._onIce = false; t._slideVx = 0; t._slideVy = 0; t._slideT = -9;
  v.fighters[0].x = 200; v.fighters[0].y = 140;    // 本機閃開
  __stamp(620, 320, 90);                            // 冰帶通到艙邊(艙 480,320 r46)
  const n0 = v.state().containLog.length, t0 = v.game.time, trace = []; let last = '';
  t.vx = -250;                                      // 朝艙擊退 → 鎖滑
  const iv = setInterval(() => {
    const r = { t: +(v.game.time - t0).toFixed(2), x: Math.round(t.x), sl: Math.round(t._slideVx), st: t.stunned, pod: Math.round(Math.hypot(t.x - 480, t.y - 320)) };
    const k = JSON.stringify([r.x, r.sl, r.st]); if (k !== last) { trace.push(r); last = k; }
    const L = v.state().containLog;
    if (L.length > n0 || v.game.time - t0 > 5) { clearInterval(iv); res({ last: L[L.length - 1] || null, trace: trace.slice(-8) }); }
  }, 25);
}));
R(`滑進艙=收容(method=${c6.last && c6.last.m}, winner=${c6.last && c6.last.w})`, !!c6.last && c6.last.m === 'ice' && c6.last.w === 0, c6.last ? '' : JSON.stringify(c6.trace));

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
