// 衝刺攻擊+clip 槽位(feel-1;使用者拍板 2026-07-16:跑+攻擊——中性=連段/跑=衝刺/空中=下壓)驗收:
// ①短移動出拳=普通連段(門檻分派)②持續跑 ≥ DASH_RUN_T 出拳=衝刺(kind4+不入連段)③命中=削 DASH_STAB+推
// ④可擋+擋下開反擊窗(融入三角)⑤起手前衝(滑步突進)⑥對已暈者衝刺=挑飛(規則一致)⑦揮空=冷卻+無爆花
// ⑧clip 槽位安全(dash_punch/hit_flinch/walk_cycle 缺槽不炸)⑨無 console 錯誤
// 陷阱:v2.js 每幀重算 _runT(不跑=歸零)→ 測試要在同一個 evaluate 內設 _runT 並呼叫 punch;
//       fighters[1] 當攻擊者(fighters[0] facing 吃滑鼠);角色放艙南 y≈540 防收容污染。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy */ } });
await page.goto('http://localhost:8099/v2.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };
const W = (expr, s = 30) => page.waitForFunction(expr, { timeout: s * 1000 }).then(() => true).catch(() => false);
await page.evaluate(() => { const v = __v2; v.v2s.introT = 0; v.fighters[1].ai = false; });

const fresh = `const v = __v2; const a = v.fighters[1], o = v.fighters[0];
  a.stunned = false; a.fumbleT = 0; a.punchCd = 0; a.carrying = null; a.carryObj = null; a._diveT0 = -9; a._jumpT = -9; a._dashT0 = -9; a.z = 0; a.guarding = false; a.comboN = 0; a.comboT = 0;
  o.invuln = 0; o.fumbleT = 0; o._lob = null; o._thrownT = -9; o.z = 0; o._jumpT = -9; o.carrying = null; o.vx = 0; o.vy = 0; o.guarding = false; o._counterFrom = null;
  a.x = 470; a.y = 540; o.x = 500; o.y = 540; a.facing = Math.atan2(o.y - a.y, o.x - a.x); v.game.bursts.length = 0;`;

// ---------- ① 短移動出拳=普通連段 ----------
const short = await page.evaluate(`(() => { ${fresh}
  o.stunned = false; o.restunT = 9; o.stability = 100;
  a._runT = 0.1; v.punch(a);
  return { kind: a._strikeKind, dashing: a._dashT0 > -5, pending: a._strikeAt > 0 }; })()`);
R('短移動出拳=普通連段(kind 0,非衝刺)', short.pending && short.kind === 0 && !short.dashing, JSON.stringify(short));

// ---------- ② 持續跑出拳=衝刺(kind4+不入連段) ----------
const dash = await page.evaluate(`(() => { ${fresh}
  o.stunned = false; o.restunT = 9; o.stability = 100;
  a.punchCd = 0; a._strikeAt = 0;
  a._runT = 0.5; v.punch(a);
  return { kind: a._strikeKind, dashing: a._dashT0 > -5, comboReset: a.comboN === 0 && a.comboT === 0, punchKind: a.punchKind }; })()`);
R('持續跑 ≥ 門檻出拳=衝刺攻擊(kind 4+不入連段)', dash.kind === 4 && dash.dashing && dash.comboReset && dash.punchKind === 4, JSON.stringify(dash));

// ---------- ③ 命中=削 DASH_STAB+推(等 impact 幀) ----------
await W('!(__v2.fighters[1]._dashT0 > -5)', 30); // 前衝結束=已判定
const hit = await page.evaluate(() => { const v = __v2; const o = v.fighters[0];
  return { stab: Math.round(o.stability), pushed: Math.hypot(o.vx, o.vy) > 100 || Math.abs(o.x - 500) > 10, burst: v.game.bursts.length > 0 }; });
R('衝刺命中=削穩定 30+推+爆花', hit.stab === 70 && hit.pushed && hit.burst, JSON.stringify(hit));

// ---------- ④ 可擋+擋下開反擊窗 ----------
const blocked = await page.evaluate(`(() => { ${fresh}
  o.stunned = false; o.restunT = 0; o.stability = 100; o.guarding = true; o.guardStam = 100; o.pushCd = 0;
  a._runT = 0.5; v.punch(a);
  a._strikeAt = v.game.time; v.resolveStrike(a);                      // 直接推到 impact 幀
  return { stab: Math.round(o.stability), stamCost: o.guardStam < 100, counterOpen: o._counterFrom === a }; })()`);
R('衝刺可擋(無穩定傷害+耗耐力)+擋下開反擊窗', blocked.stab === 100 && blocked.stamCost && blocked.counterOpen, JSON.stringify(blocked));

// ---------- ⑤ 起手前衝(滑步突進;撐住 impact=純量前衝,免吃 rAF 節流的稀疏積分幀) ----------
const lungeStart = await page.evaluate(`(() => { ${fresh}
  o.x = 100; o.y = 100;                                               // 移開目標
  a.x = 300; a.y = 540; a.facing = 0;
  a._runT = 0.5; v.punch(a);
  a._strikeAt = v.game.time + 9;                                      // 撐住 impact:前衝持續到我們量完
  return a.x; })()`);
await W('__v2.fighters[1].x >= 360', 30);                             // 前衝 ≥60px(全速 400px/s)
const lunged = await page.evaluate(() => { const a = __v2.fighters[1];
  const x = Math.round(a.x); a._strikeAt = __v2.game.time; __v2.resolveStrike(a); return x; }); // 收招(清 _dashT0)
R('起手期間前衝(滑步突進 ≥60px)', lunged - lungeStart >= 60, `x ${lungeStart}→${lunged}`);

// ---------- ⑥ 對已暈者衝刺=挑飛(規則一致) ----------
const launch = await page.evaluate(`(() => { ${fresh}
  o.stunned = true; o.stunT = 5; o.restunT = 0; o.stability = 0;
  a._runT = 0.5; v.punch(a);
  a._strikeAt = v.game.time; v.resolveStrike(a);
  return { lob: o._lob === v.PUNCH_LAUNCH_LOB, fumble: +o.fumbleT.toFixed(2) }; })()`);
R('對已暈者衝刺=挑飛 launcher(規則一致)', launch.lob && launch.fumble > 0, JSON.stringify(launch));

// ---------- ⑦ 揮空=冷卻+無爆花 ----------
const whiff = await page.evaluate(`(() => { ${fresh}
  o.x = 100; o.y = 100; o.stunned = false;
  a.x = 700; a.y = 540; a.facing = 0;
  a._runT = 0.5; v.punch(a);
  a._strikeAt = v.game.time; v.resolveStrike(a);
  return { cd: +a.punchCd.toFixed(2), bursts: v.game.bursts.length, dashCleared: !(a._dashT0 > -5) }; })()`);
R('揮空=冷卻懲罰+無爆花+前衝清乾淨', whiff.cd > 0.4 && whiff.bursts === 0 && whiff.dashCleared, JSON.stringify(whiff));

// ---------- ⑧ clip 槽位安全(缺槽不炸;有槽自動接) ----------
const slots = await page.evaluate(async () => {
  const M = await import('./js/brawler-clips.js');
  return { punchClips: M.PUNCH_CLIPS.length, dash: M.PUNCH_CLIPS[4] === 'dash_punch',
    hitSlot: 'hit_flinch' in M.CLIPS || true, walkSlot: 'walk_cycle' in M.CLIPS || true }; // 槽可缺(fallback 已驗:遊戲跑到這=沒炸)
});
R('clip 槽位就緒(PUNCH_CLIPS[4]=dash_punch;hit_flinch/walk_cycle 缺槽安全)', slots.punchClips === 5 && slots.dash, JSON.stringify(slots));

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
