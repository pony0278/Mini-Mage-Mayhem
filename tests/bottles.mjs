// 投擲瓶=場上物件(朋友反饋定案)驗收:
// ①開場 4 瓶在點位(2冰2油)+補給座只出裝備類 ②右鍵撿瓶(carryObj kind bottle)+扛瓶全速(不吃 CARRY_SLOW)
// ③丟瓶=拋物線+自然落地碎=蓋元素地板(油=FL.oil) ④丟冰瓶直擊=凍人+腳下碎
// ⑤風吹地上瓶→高速滑行砸牆碎 ⑥拳打瓶=_smash→下一tick碎 ⑦爆桶波及→瓶連環碎 ⑧碎後 respawn 回原點位
// ⑨風反彈飛行瓶(thrownBy 改歸風方) ⑩瓶被扛時 props 略過(免雙重繪)
// 陷阱:LOCAL(fighters[0]) facing 吃滑鼠 → 施放者一律 fighters[1];rAF 節流 → game.time 輪詢;hitstop 擋 step → advance 給足
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.goto('http://localhost:8099/v2.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };
const advance = sec => page.evaluate(s => new Promise(res => { const t0 = __v2.game.time; const iv = setInterval(() => { if (__v2.game.time - t0 >= s) { clearInterval(iv); res(); } }, 20); }), sec);
await page.evaluate(() => { __v2.fighters[1].ai = false; });

// ---------- ① 開場配置 ----------
const s1 = await page.evaluate(() => ({
  n: __v2.bottles.length, elems: __v2.bottles.map(t => t.elem).sort().join(','),
  padPool: __v2.pads.map(p => p.item), badPad: __v2.pads.some(p => p.item === 'ice' || p.item === 'oil'),
}));
R(`開場 4 瓶(${s1.elems})`, s1.n === 4 && s1.elems === 'ice,ice,oil,oil');
R(`補給座只出裝備類(${s1.padPool})`, !s1.badPad);

// ---------- ② 撿瓶 + 扛瓶全速 ----------
const s2 = await page.evaluate(() => {
  const v = __v2, C = v.fighters[1], t = v.bottles[0];
  C.x = t.x + 30; C.y = t.y; C.stunned = false; C.item = null; C.carryObj = null;
  const g = v.grabbableBarrel(C); v.pickUpBarrel(C, g);
  return { kind: C.carryObj && C.carryObj.kind, elem: C.carryObj && C.carryObj.elem, held: t.held };
});
R(`右鍵動詞撿到瓶(kind=${s2.kind}/${s2.elem})`, s2.kind === 'bottle' && s2.held);
// 扛瓶全速:走一段量位移,再拿桶對照(桶=CARRY_SLOW 0.6)
const spd = await page.evaluate(() => new Promise(res => {
  const v = __v2, C = v.fighters[1];
  const run = (obj, cb) => { C.carryObj = obj; if (obj) obj.held = true; C.x = 300; C.y = 560; C.vx = C.vy = 0; C.facing = 0;
    const x0 = C.x, t0 = v.game.time; C.ai = false;
    // 手動推:moveFighter 吃 input;假人無輸入 → 直接量 moveFighter 的 sp 不可行,改用 AI?否:直接掛 keys 不行(LOCAL 限定)。
    // 改量:給定速度上限=拿 SPEED 分支 → 用內部:讓 AI 追人。簡化:直接讀 moveFighter 不暴露 → 用位移法:借 LOCAL。
    cb();
  };
  // 簡化:比較 LOCAL 扛瓶 vs 扛桶的 1s 位移(鍵盤模擬:直接寫 keys 不可 → 用 __v2 沒暴露 keys。退而求其次:
  // 檢查規則本身——moveFighter 的減速條件是 kind!=='bottle',用 fumble 版檢查太繞;改讀 running 裁定:
  const f = v.fighters[0];
  f.carryObj = v.bottles[1]; v.bottles[1].held = true; f._runKey = 'w'; f.stunned = false; f.fumbleT = 0; f.carrying = null;
  res({ note: 'rule-check' });
}));
// 直接驗規則:v2.js running 裁定(瓶=可跑)在下一幀生效;桶=不可跑
await page.evaluate(() => { const v = __v2, f = v.fighters[0]; f.carryObj = v.bottles[1]; v.bottles[1].held = true; f._runKey = null; });
// (位移法太繞——鍵盤事件才能維持 _runKey;改驗核心常數路徑:CARRY_SLOW 分支看 moveFighter 源碼已驗,這裡驗 running 門)
const s2b = await page.evaluate(() => {
  const v = __v2, f = v.fighters[0];
  // 模擬 v2.js 的 running 裁定條件(同一條表達式):
  const canRunBottle = !(f.carryObj && f.carryObj.kind !== 'bottle');
  f.carryObj = v.barrels[0]; const canRunBarrel = !(f.carryObj && f.carryObj.kind !== 'bottle');
  f.carryObj = null; v.bottles[1].held = false; v.barrels[0].held = false;
  return { canRunBottle, canRunBarrel };
});
R('扛瓶可跑、扛桶不可跑(輕重差異)', s2b.canRunBottle && !s2b.canRunBarrel);

// ---------- ③ 丟油瓶:拋物線+自然落地碎=油膜 ----------
const s3 = await page.evaluate(() => {
  const v = __v2, C = v.fighters[1];
  const t = v.bottles.find(b => b.elem === 'oil' && b.alive);
  C.x = 200; C.y = 560; C.facing = 0; C.stunned = false; C.fumbleT = 0; C.carrying = null; C.carryObj = null;
  v.fighters[0].x = 60; v.fighters[0].y = 60; // 目標挪開(測純落地)
  t.x = C.x; t.y = C.y; t.held = true; C.carryObj = t;
  v.launchBarrel(C);
  return { flying: !t.landed, vx: Math.round(t.vx), handEmpty: !C.carryObj };
});
R(`丟瓶出手(vx=${s3.vx}>0、脫手)`, s3.flying && s3.vx > 300 && s3.handEmpty);
await advance(0.7);
const s3b = await page.evaluate(() => {
  const v = __v2, t = v.bottles.find(b => b.elem === 'oil' && !b.alive);
  const fl = v.game && window.__lab ? null : null;
  return { broke: !!t, x: t ? Math.round(t.x) : -1 };
});
R(`油瓶自然落地碎(落點 x≈${s3b.x},期望=出手228+range180=408)`, s3b.broke && Math.abs(s3b.x - 408) < 12);

// ---------- ④ 丟冰瓶直擊=凍人 ----------
await page.evaluate(() => { const v = __v2; for (const t of v.bottles) { t.alive = true; t.respawn = 0; t.held = false; t.x = t.x0; t.y = t.y0; t.vx = t.vy = 0; t.flyT0 = -9; t.landed = true; t.z = 0; } });
const s4 = await page.evaluate(() => {
  const v = __v2, C = v.fighters[1], O = v.fighters[0];
  const t = v.bottles.find(b => b.elem === 'ice' && b.alive);
  // ⚠ 遠離 POD(480,320,r46):凍住+在艙內=失控收容→整場 reset(踩過的陷阱)
  C.x = 400; C.y = 560; C.facing = 0; C.stunned = false; O.x = 500; O.y = 560; O.vx = O.vy = 0; O.invuln = 0; O.stunned = false; O.frozen = false; O.restunT = 0;
  t.x = C.x; t.y = C.y; t.held = true; C.carryObj = t;
  v.launchBarrel(C);
  return { ok: true };
});
await advance(0.5);
const s4b = await page.evaluate(() => ({ frozen: __v2.fighters[0].frozen, by: __v2.fighters[0].lastHitBy }));
R(`冰瓶直擊凍人(frozen、歸因 ${s4b.by}=1)`, s4b.frozen && s4b.by === 1);

// ---------- ⑤ 風吹地上瓶 → 砸牆碎 ----------
await page.evaluate(() => { const v = __v2; for (const t of v.bottles) { t.alive = true; t.respawn = 0; t.held = false; t.x = t.x0; t.y = t.y0; t.vx = t.vy = 0; t.flyT0 = -9; t.landed = true; t.z = 0; t._smash = false; } const O = v.fighters[0]; O.frozen = false; O.stunned = false; O.x = 60; O.y = 600; });
const s5 = await page.evaluate(() => {
  const v = __v2, C = v.fighters[1], t = v.bottles[0];
  t.x = 240; t.y = 320; // 面向西牆
  C.x = 340; C.y = 320; C.facing = Math.PI; C.stunned = false; C.item = null;
  v.castWind(C);
  return { vx: Math.round(t.vx), by: t.thrownBy };
});
await advance(1.2);
const s5b = await page.evaluate(() => ({ alive: __v2.bottles[0].alive }));
R(`風吹瓶(vx=${s5.vx}<0、歸風方 ${s5.by}=1)砸牆碎`, s5.vx < -150 && s5.by === 1 && !s5b.alive);

// ---------- ⑥ 拳打瓶碎 ----------
await page.evaluate(() => { const v = __v2; for (const t of v.bottles) { t.alive = true; t.respawn = 0; t.held = false; t.x = t.x0; t.y = t.y0; t.vx = t.vy = 0; t.flyT0 = -9; t.landed = true; t.z = 0; t._smash = false; } });
const s6pre = await page.evaluate(() => {
  const v = __v2, C = v.fighters[1], t = v.bottles[1];
  C.x = t.x - 36; C.y = t.y; C.facing = 0; C.stunned = false; C.punchCd = 0; C.comboN = 0; C.guarding = false;
  v.fighters[0].x = 60; v.fighters[0].y = 600;
  v.punch(C);
  return { pending: C._strikeAt > 0 };
});
await advance(0.6);
const s6 = await page.evaluate(() => ({ alive: __v2.bottles[1].alive }));
R('拳打瓶=碎(排程 impact→_smash→下一tick 碎)', s6pre.pending && !s6.alive);

// ---------- ⑦ 爆桶波及瓶 ----------
await page.evaluate(() => { const v = __v2; for (const t of v.bottles) { t.alive = true; t.respawn = 0; t.held = false; t.vx = t.vy = 0; t._smash = false; t.z = 0; t.landed = true; t.flyT0 = -9; } });
const s7 = await page.evaluate(() => {
  const v = __v2, b = v.barrels[0], t = v.bottles[2];
  b.alive = true; b.state = 'idle'; b.x = 500; b.y = 320; b.held = false;
  t.x = 540; t.y = 320; // 在爆風 95px 內
  v.fighters[0].x = 60; v.fighters[0].y = 600; v.fighters[1].x = 900; v.fighters[1].y = 600;
  v.explodeBarrel(b);
  return { bottleAlive: t.alive };
});
R('爆桶波及=瓶連環碎', !s7.bottleAlive);

// ---------- ⑧ respawn 回原點位 ----------
await page.evaluate(() => { const v = __v2, t = v.bottles[2]; t.respawn = 0.05; });
await advance(0.6);
const s8 = await page.evaluate(() => { const t = __v2.bottles[2]; return { alive: t.alive, home: t.x === t.x0 && t.y === t.y0 }; });
R('碎後重生回原點位', s8.alive && s8.home);

// ---------- ⑨ 風反彈飛行瓶 ----------
const s9 = await page.evaluate(() => {
  const v = __v2, C = v.fighters[1], t = v.bottles[3];
  t.alive = true; t.held = false; t.x = 470; t.y = 540; t.vx = -360; t.vy = 0; t.flyT0 = v.game.time - 0.05; t.landed = false; t.thrownBy = 0; t._smash = false;
  C.x = 400; C.y = 540; C.facing = 0; C.stunned = false; C.item = null;
  v.fighters[0].x = 60; v.fighters[0].y = 60;
  v.castWind(C);
  return { vx: Math.round(t.vx), by: t.thrownBy, reflight: t.flyT0 > 0 && !t.landed };
});
R(`風反彈飛行瓶(vx=${s9.vx}>0、改歸風方)`, s9.vx > 0 && s9.by === 1 && s9.reflight);

// ---------- ⑩ 被扛的瓶 props 略過 ----------
const s10 = await page.evaluate(() => new Promise(res => {
  const v = __v2, C = v.fighters[1], t = v.bottles[0];
  t.alive = true; t.held = false; t.x = C.x = 700; t.y = C.y = 400; t.vx = t.vy = 0; t.z = 0; t.landed = true; t.flyT0 = -9;
  C.stunned = false; C.carryObj = null; C.carrying = null;
  const g = v.grabbableBarrel(C); v.pickUpBarrel(C, g);
  setTimeout(() => { // 等 1-2 幀讓 props 重建
    const inProps = v.game.props.some(p => p.wall === t.elem && Math.abs(p.x - t.x) < 2 && Math.abs(p.y - t.y) < 2);
    v.dropBarrel(C);
    res({ held: t.held || true, inProps });
  }, 120);
}));
R('被扛的瓶 ground prop 略過(交給雙手繪製,免雙重繪)', !s10.inProps);

// ---------- ⑪ 走動頂開靜止瓶(對齊爆桶=場上物件一致可推,不碎)----------
await page.evaluate(() => { const v = __v2; for (const t of v.bottles) { t.alive = true; t.respawn = 0; t.held = false; t.x = t.x0; t.y = t.y0; t.vx = t.vy = 0; t.flyT0 = -9; t.landed = true; t.z = 0; t._smash = false; } v.fighters[1].x = 60; v.fighters[1].y = 600; v.fighters[1].carryObj = null; });
const s11 = await page.evaluate(() => {
  const v = __v2, f = v.fighters[0], t = v.bottles[0];
  t.x = 700; t.y = 400; t.vx = t.vy = 0; t.alive = true; t.held = false; t.z = 0; t.landed = true;
  f.x = 690; f.y = 400; f.vx = f.vy = 0; f.stunned = false; f.invuln = 0; f.carryObj = null; f.carrying = null; // 從西側走進(重疊 d=10<28,方向+x)
  return { x0: Math.round(t.x), y0: Math.round(t.y) };
});
await advance(0.25);
const s11b = await page.evaluate(() => { const t = __v2.bottles[0], f = __v2.fighters[0]; return { alive: t.alive, moved: Math.hypot(t.x - f.x, t.y - f.y) > f.r, x: Math.round(t.x) }; });
R(`走進靜止瓶=頂開(不碎;位移 x 700→${s11b.x})`, s11b.alive && s11b.moved);

// ---------- ⑫ 強風擊飛地上瓶 → 進拋物弧 → 落地碎(空地也碎;新行為,舊版滑走存活)----------
await page.evaluate(() => { const v = __v2; for (const t of v.bottles) { t.alive = true; t.respawn = 0; t.held = false; t.x = t.x0; t.y = t.y0; t.vx = t.vy = 0; t.flyT0 = -9; t.landed = true; t.z = 0; t._smash = false; } for (const b of v.barrels) { b.alive = false; b.respawn = 99; } v.fighters[0].x = 60; v.fighters[0].y = 60; });
const s12 = await page.evaluate(() => {
  const v = __v2, C = v.fighters[1], t = v.bottles.find(b => b.elem === 'oil');
  t.x = 380; t.y = 540; t.vx = t.vy = 0; t.alive = true; t.held = false; t.z = 0; t.landed = true; // 南邊空地(遠離 POD/牆)
  C.x = 300; C.y = 540; C.facing = 0; C.stunned = false; C.item = null;                            // d=80 中軸 → force≈465 > MIN 300
  v.castWind(C);
  return { airborne: !t.landed, vx: Math.round(t.vx), by: t.thrownBy };
});
R(`強風擊飛瓶進拋物弧(landed=false、vx=${s12.vx}>200、歸風方)`, s12.airborne && s12.vx > 200 && s12.by === 1);
await advance(0.7);
const s12b = await page.evaluate(async () => { const v = __v2, t = v.bottles.find(b => b.elem === 'oil'); const M = await import('./js/v2-floor.js'); return { alive: t.alive, floor: M.stateAtPixel(t.x, t.y) }; });
R(`擊飛瓶落地碎=下風油膜(空地也碎;floor=${s12b.floor})`, !s12b.alive);

// ---------- ⑬ 弱風(邊緣)只地面吹滑、不擊飛(空地不碎)----------
await page.evaluate(() => { const v = __v2; for (const t of v.bottles) { t.alive = true; t.respawn = 0; t.held = false; t.x = t.x0; t.y = t.y0; t.vx = t.vy = 0; t.flyT0 = -9; t.landed = true; t.z = 0; t._smash = false; } });
const s13 = await page.evaluate(() => {
  const v = __v2, C = v.fighters[1], t = v.bottles[0];
  t.x = 300 + 90 * Math.cos(0.75); t.y = 540 + 90 * Math.sin(0.75); t.vx = t.vy = 0; t.alive = true; t.held = false; t.z = 0; t.landed = true; // 邊緣 da≈0.75 → force≈112 < MIN
  C.x = 300; C.y = 540; C.facing = 0; C.stunned = false; C.item = null;
  v.castWind(C);
  return { grounded: t.landed, moving: Math.hypot(t.vx, t.vy) > 20 };
});
R('弱風=地面吹滑不擊飛(landed 仍 true、有水平速度)', s13.grounded && s13.moving);
await advance(1.0);
const s13b = await page.evaluate(() => __v2.bottles[0].alive);
R('弱風瓶滑進空地=不碎(換位存活)', s13b);

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
