// 風壓手套=遠距扇形放射狀衝擊波 驗收:
// ①排程施法(uses3→2、rhook、延遲才發動)②施法中被暈=取消不退次數 ③距離衰減(近>遠)④角度衰減(中軸>邊緣)
// ⑤放射狀方向(偏軸目標被斜著吹歪)⑥吹動桶(idle 桶被吹走+升壓)⑦無貼臉自反噬 ⑧反彈冰瓶+凍原主 ⑨穿防
// 陷阱:LOCAL(fighters[0]) facing 吃滑鼠 → 風施放者一律用 fighters[1];rAF 節流 → game.time 輪詢
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

// 直接 castWind 量單發衝量(繞排程):C=fighters[1] 施放者,O=fighters[0] 目標,回傳 O 的 vx/vy(施放前歸零)
const blastImpulse = (cx, cy, face, ox, oy) => page.evaluate(([cx, cy, face, ox, oy]) => {
  const v = __v2, C = v.fighters[1], O = v.fighters[0];
  C.x = cx; C.y = cy; C.facing = face; C.stunned = false; C.vx = C.vy = 0;
  O.x = ox; O.y = oy; O.vx = O.vy = 0; O.invuln = 0; O.stunned = false; O.guarding = false; O.carriedBy = null;
  O._thrownT = -9; O.fumbleT = 0; O._lob = null;
  v.castWind(C);
  return { ovx: O.vx, ovy: O.vy, cvx: C.vx, cvy: C.vy, mag: Math.hypot(O.vx, O.vy), thrown: O._thrownT > -5, fumble: O.fumbleT };
}, [cx, cy, face, ox, oy]);

// ---------- ① 排程施法 ----------
await page.evaluate(() => { const v = __v2, C = v.fighters[1], O = v.fighters[0]; C.x = 400; C.y = 540; C.facing = 0; C.item = 'wind'; C.itemUses = 3; C.itemCastCd = 0; C._itemCastAt = 0; C.stunned = false; O.x = 480; O.y = 540; O.vx = O.vy = 0; O.invuln = 0; O.stunned = false; });
const s1 = await page.evaluate(() => { const v = __v2; v.useItem(v.fighters[1]); const C = v.fighters[1]; return { uses: C.itemUses, clip: C.itemClip, pending: C._itemCastAt > 0, oVx: Math.round(v.fighters[0].vx) }; });
R(`起手扣次數(3→${s1.uses})+排程 rhook`, s1.uses === 2 && s1.clip === 'rhook' && s1.pending && s1.oVx === 0);
await advance(0.4);
const s1b = await page.evaluate(() => ({ oVx: Math.round(__v2.fighters[0].vx), pending: __v2.fighters[1]._itemCastAt > 0 }));
R(`impact 幀才發動擊退(oVx ${s1b.oVx}>0)`, s1b.oVx > 0 && !s1b.pending);

// ---------- ② 施法中被打斷=取消不退次數 ----------
await page.evaluate(() => { const v = __v2, C = v.fighters[1], O = v.fighters[0]; C.x = 400; C.y = 200; C.facing = 0; C.item = 'wind'; C.itemUses = 3; C.itemCastCd = 0; C._itemCastAt = 0; C.stunned = false; C.restunT = 0; O.x = 480; O.y = 200; O.vx = O.vy = 0; O.invuln = 0; O.stunned = false; O.frozen = false; v.useItem(C); v.stunFighter(C); }); // y=200 北列+清 O 暈:①的牆暈殘留+原 (480,300) 在艙半徑內=「暈者在艙」誤觸收容演出,污染後續 case
await advance(0.4);
// C 案:被暈→道具掉地上(帶剩餘 2 次=用掉的那次不退還)。取消發動(無擊退)+ 手上清空 + 地上有 2 次。
const s2 = await page.evaluate(() => { const g = __v2.groundItems.find(x => x.type === 'wind'); return { oVx: Math.round(__v2.fighters[0].vx), handItem: __v2.fighters[1].item, groundUses: g ? g.uses : -1 }; });
R('施法中被暈=取消發動 + 道具掉地上帶剩餘 2 次(用掉不退)', Math.abs(s2.oVx) < 5 && s2.handItem === null && s2.groundUses === 2);

// ---------- ③ 距離衰減(近 > 遠,皆中軸)----------
const near = await blastImpulse(400, 540, 0, 460, 540);   // d=60
const far = await blastImpulse(400, 540, 0, 660, 540);    // d=260
R(`距離衰減:近(${Math.round(near.mag)}) > 遠(${Math.round(far.mag)})`, near.mag > far.mag + 50 && far.mag > 0);

// ---------- ④ 角度衰減(中軸 > 邊緣,同距離 d≈140)----------
const axis = await blastImpulse(400, 300, 0, 540, 300);           // 中軸 θ=0
const edge = await blastImpulse(400, 300, 0, 400 + 140 * Math.cos(0.9), 300 + 140 * Math.sin(0.9)); // θ≈0.9≈邊緣
R(`角度衰減:中軸(${Math.round(axis.mag)}) > 邊緣(${Math.round(edge.mag)})`, axis.mag > edge.mag + 30);

// ---------- ④.5 吹翻滾:近中心強命中=接拋飛管線(翻滾)、邊緣弱命中=只吹歪(不翻)----------
const tum = await blastImpulse(400, 540, 0, 470, 540);   // d=70 → force≈484 > MIN 300 → 翻滾(y=540 南列:原 y=300 目標在艙半徑內,吹飛觸發收容演出把人釘艙心 2.1s 污染 ⑧)
R(`近中心強命中=吹翻滾(_thrownT+fumbleT;force≈484)`, tum.thrown && tum.fumble > 0);
const nudge = await blastImpulse(400, 300, 0, 400 + 150 * Math.cos(0.92), 300 + 150 * Math.sin(0.92)); // 邊緣 → force<MIN → 不翻
R('邊緣弱命中=只吹歪不翻(無 _thrownT)', !nudge.thrown && nudge.mag > 0);

// ---------- ⑤ 放射狀方向(偏下的目標被往下斜著吹)----------
const rad = await blastImpulse(300, 500, 0, 380, 560);   // 目標在前方偏下 → 放射向量 (0.8,0.6)(避開 POD:原 (480,360) 在艙半徑內)
R(`放射狀:偏軸目標被斜吹(ovx>0 且 ovy>0;ovy=${Math.round(rad.ovy)})`, rad.ovx > 0 && rad.ovy > 20);

// ---------- ⑥ 吹動桶(idle 桶被吹走 + 升壓)----------
const barrel = await page.evaluate(() => {
  const v = __v2, C = v.fighters[1], b = v.barrels[0];
  b.alive = true; b.state = 'idle'; b.x = 300; b.y = 320; b.vx = b.vy = 0; b.held = false;
  C.x = 200; C.y = 320; C.facing = 0; C.stunned = false;   // 桶在正前方 d=100
  v.castWind(C);
  return { bvx: Math.round(b.vx), state: b.state };
});
R(`吹動桶:被吹走(bvx ${barrel.bvx}>0)+升壓(${barrel.state})`, barrel.bvx > 0 && barrel.state === 'fuse');

// ---------- ⑦ 無貼臉自反噬(施放者不反彈)----------
const pointblank = await blastImpulse(400, 540, 0, 420, 540);  // 目標貼臉 d=20
R(`無自反噬(施放者 cvx=${Math.round(pointblank.cvx)}≈0)`, Math.abs(pointblank.cvx) < 5 && Math.abs(pointblank.cvy) < 5);

// ---------- ⑧ 反彈飛行冰瓶(場上物件版)+ 凍原主 ----------
const refl = await page.evaluate(() => new Promise(res => {
  const v = __v2, C = v.fighters[1], O = v.fighters[0];
  for (const b of v.barrels) { b.alive = false; b.respawn = 99; b.state = 'idle'; b.vx = b.vy = 0; } // 中和 ⑥ 留下的升壓桶:引信爆炸的「波及碎瓶」會把飛行瓶提前炸掉(污染此測試)
  C.x = 400; C.y = 540; C.facing = 0; C.stunned = false; C.item = null;
  O.x = 600; O.y = 540; O.vx = O.vy = 0; O.invuln = 0; O.stunned = false; O.frozen = false; O.restunT = 0;
  const t = v.bottles.find(b => b.elem === 'ice');
  t.alive = true; t.held = false; t._smash = false;
  t.x = 470; t.y = 540; t.vx = -360; t.vy = 0; t.flyT0 = v.game.time - 0.05; t.landed = false; t.thrownBy = 0;
  v.castWind(C);
  const by0 = t.thrownBy, pvx = Math.round(t.vx);
  O.x = 600; O.y = 540; O.vx = O.vy = 0; O._thrownT = -9; O.fumbleT = 0; O.frozen = false; // 風也直接吹到原主→釘回隔離「反彈-凍」測試
  const t0 = v.game.time;
  const iv = setInterval(() => { if (O.frozen || v.game.time - t0 > 2) { clearInterval(iv); res({ by0, pvx, frozen: O.frozen, by: O.lastHitBy }); } }, 20);
}));
R('反彈:改歸風方(thrownBy=1)+甩回(pvx>0)', refl.by0 === 1 && refl.pvx > 0);
R(`反彈瓶凍原主(frozen)+歸因風方(by ${refl.by}=1)`, refl.frozen && refl.by === 1);

// ---------- ⑨ 穿防 ----------
const guard = await page.evaluate(() => {
  const v = __v2, C = v.fighters[1], O = v.fighters[0];
  C.x = 400; C.y = 200; C.facing = 0; C.stunned = false;
  O.x = 470; O.y = 200; O.vx = O.vy = 0; O.invuln = 0; O.stunned = false; O.guarding = true; O.guardStam = 100;
  v.castWind(C);
  return Math.round(O.vx);
});
R(`風穿防:吹得動舉防者(oVx ${guard}>0)`, guard > 0);

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
