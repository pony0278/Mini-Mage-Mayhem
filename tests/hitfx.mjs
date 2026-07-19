// 漫畫打擊爆花(hitfx-1;使用者拍板 2026-07-16:GetAmped 風=拳頭的打擊語言,元素維持發光粒子)驗收:
// ①鉤拳命中=小橘爆花(無速度線)②挑飛=最大檔(集中線+速度線+白閃)③打暈那拳=琥珀檔
// ④反擊拳=金色爆花 ⑤下壓拳=紅色爆花 ⑥爆花會老化消失(壽命到=移除)⑦揮空不出爆花
// ⑧頓點分級(feel-3):普通 0.10<挑飛 0.20<打暈 0.22<反擊 0.26(>舊帽 0.12=帽已放開)⑨hitstopMul 倍率生效 ⑩無 console 錯誤
// 陷阱:sim 側斷言 game.bursts(fx.addBurst 推、v2-hud 消費);判定直接呼叫 resolveStrike;角色放艙南 y≈540。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy */ } });
await page.goto('http://localhost:8099/v2.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };
await page.evaluate(() => { const v = __v2; v.v2s.introT = 0; v.fighters[1].ai = false; });

const hit = (setup) => page.evaluate((code) => { const v = __v2; const a = v.fighters[1], o = v.fighters[0];
  v.game.bursts.length = 0;
  a.stunned = false; a.fumbleT = 0; a.punchCd = 0; a.carrying = null; a.carryObj = null; a._diveT0 = -9; a._jumpT = -9;
  o.invuln = 0; o.fumbleT = 0; o._lob = null; o._thrownT = -9; o.z = 0; o._jumpT = -9; o.carrying = null; o.vx = o.vy = 0;
  a.x = 470; a.y = 540; o.x = 500; o.y = 540;
  new Function('v', 'a', 'o', code)(v, a, o);
  const b = v.game.bursts[v.game.bursts.length - 1] || null;
  return { n: v.game.bursts.length, b: b && { size: b.size, col: b.col, streaks: b.streaks, flash: b.flash, focus: b.focus } };
}, setup);

// ---------- ① 鉤拳=小橘爆花(無線無閃) ----------
const hook = await hit(`o.stunned=false; o.restunT=9; o.stability=100;
  a._strikeKind=0; a._strikeDir=Math.atan2(o.y-a.y,o.x-a.x); v.resolveStrike(a);`);
R('鉤拳命中=小橘爆花(無速度線/白閃)', hook.n === 1 && hook.b.col === '#ff8a3a' && hook.b.size === 22 && !hook.b.streaks && !hook.b.flash, JSON.stringify(hook));

// ---------- ② 挑飛=最大檔(集中線) ----------
const launch = await hit(`o.stunned=true; o.stunT=5; o.restunT=0; o.stability=0; o.carriedBy=null;
  a._strikeKind=0; a._strikeDir=Math.atan2(o.y-a.y,o.x-a.x); v.resolveStrike(a);`);
R('挑飛=最大檔爆花(size46+速度線+白閃+集中線)', launch.n === 1 && launch.b.size === 46 && launch.b.streaks > 0 && launch.b.flash > 0 && launch.b.focus, JSON.stringify(launch));

// ---------- ③ 打暈那拳=琥珀檔 ----------
const stun = await hit(`o.stunned=false; o.restunT=0; o.stability=10;
  a._strikeKind=0; a._strikeDir=Math.atan2(o.y-a.y,o.x-a.x); v.resolveStrike(a);`);
R('打暈那拳=琥珀爆花(#ffb300)', stun.n === 1 && stun.b.col === '#ffb300' && stun.b.streaks > 0, JSON.stringify(stun));

// ---------- ④ 反擊拳=金色 ----------
const counter = await hit(`o.stunned=false; o.stability=100; o.pushCd=0; o.punchCd=0; o.guardStam=100; o._thrownT=-9; o.z=0;
  a.stability=100; a.restunT=0;
  o._counterFrom=a; o._counterAt=v.game.time-0.02; v.punch(o);`);
R('反擊拳=金色爆花(#ffd700)', counter.n === 1 && counter.b.col === '#ffd700', JSON.stringify(counter));

// ---------- ⑤ 下壓拳=紅色 ----------
const dive = await hit(`o.stunned=false; o.restunT=9; o.stability=100; o.guarding=false;
  a._diveT0=v.game.time-0.01; a._diveZ0=20; a._strikeKind=3; a._strikeDir=Math.atan2(o.y-a.y,o.x-a.x); v.resolveStrike(a);`);
R('下壓拳=紅色爆花(#ff4a4a)', dive.n === 1 && dive.b.col === '#ff4a4a', JSON.stringify(dive));

// ---------- ⑥ 爆花老化:壽命到=移除 ----------
const aged = await page.evaluate(() => new Promise(res => { const v = __v2;
  v.game.bursts.length = 0;
  v.game.bursts.push({ x: 100, y: 100, t: 0, life: 0.1, size: 20, col: '#fff', streaks: 0, streakA: 0, flash: 0, focus: false, seed: 0, pts: 8 });
  const t0 = v.game.time;
  const iv = setInterval(() => { if (v.game.bursts.length === 0 || v.game.time - t0 > 2) { clearInterval(iv); res(v.game.bursts.length); } }, 25);
}));
R('爆花壽命到=移除(updateRings 老化)', aged === 0, 'left=' + aged);

// ---------- ⑦ 揮空=無爆花 ----------
const whiff = await hit(`o.x=100; o.y=100; a._strikeKind=0; a._strikeDir=0; v.resolveStrike(a);`);
R('揮空不出爆花', whiff.n === 0, JSON.stringify(whiff));

// ---------- ⑧ 頓點分級(feel-3):HIT_STOP 表生效、輕重讀得出、舊 0.12 帽已放開 ----------
const hstop = (setup) => page.evaluate((code) => { const v = __v2; const a = v.fighters[1], o = v.fighters[0];
  v.game.hitstop = 0;
  a.stunned = false; a.fumbleT = 0; a.punchCd = 0; a.carrying = null; a.carryObj = null; a._diveT0 = -9; a._jumpT = -9; a._recoverT = 0;
  o.invuln = 0; o.fumbleT = 0; o._lob = null; o._thrownT = -9; o.z = 0; o._jumpT = -9; o.carrying = null; o.vx = o.vy = 0; o.guarding = false;
  a.x = 470; a.y = 540; o.x = 500; o.y = 540;
  new Function('v', 'a', 'o', code)(v, a, o);
  return +v.game.hitstop.toFixed(3);
}, setup);
const hsPunch = await hstop(`o.stunned=false; o.restunT=9; o.stability=100;
  a._strikeKind=0; a._strikeDir=Math.atan2(o.y-a.y,o.x-a.x); v.resolveStrike(a);`);
const hsLaunch = await hstop(`o.stunned=true; o.stunT=5; o.restunT=0; o.stability=0; o.carriedBy=null;
  a._strikeKind=0; a._strikeDir=Math.atan2(o.y-a.y,o.x-a.x); v.resolveStrike(a);`);
const hsStun = await hstop(`o.stunned=false; o.restunT=0; o.stability=10;
  a._strikeKind=0; a._strikeDir=Math.atan2(o.y-a.y,o.x-a.x); v.resolveStrike(a);`);
const hsCounter = await hstop(`o.stunned=false; o.stability=100; o.pushCd=0; o.punchCd=0; o.guardStam=100; a.stability=100; a.restunT=0;
  o._counterFrom=a; o._counterAt=v.game.time-0.02; v.punch(o);`);
const near = (x, e) => Math.abs(x - e) < 0.001;
R('頓點分級:普通 0.10/挑飛 0.20/打暈 0.22/反擊 0.26(輕重差 2.6×)',
  near(hsPunch, 0.10) && near(hsLaunch, 0.20) && near(hsStun, 0.22) && near(hsCounter, 0.26),
  `punch=${hsPunch} launch=${hsLaunch} stun=${hsStun} counter=${hsCounter}`);
R('舊 0.12 硬帽已放開(反擊 0.26 完整生效)', hsCounter > 0.12, `counter=${hsCounter}`);

// ---------- ⑨ hitstopMul 全域倍率(?tune=1 滑桿)----------
const hsMul = await hstop(`v.v2s.hitstopMul = 2; o.stunned=false; o.restunT=9; o.stability=100;
  a._strikeKind=0; a._strikeDir=Math.atan2(o.y-a.y,o.x-a.x); v.resolveStrike(a); v.v2s.hitstopMul = 1;`);
R('hitstopMul=2 → 普通拳頓點 0.20(倍率生效,已復原 1)', near(hsMul, 0.20), `mul2 punch=${hsMul}`);

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
